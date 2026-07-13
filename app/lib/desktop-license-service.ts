import { drizzle } from 'drizzle-orm/d1'
import { and, asc, count, desc, eq, gt, inArray, lte } from 'drizzle-orm'
import * as schema from '@/lib/schema'
import {
  desktopActivationGrants,
  desktopLicenseKeys,
  desktopLicensePeriods,
  desktopLicenses,
  desktopUsageReservations,
  tinypngKeyPool,
} from '@/lib/schema'
import { createDesktopSecret, sha256Hex } from '@/lib/desktop-license-crypto'
import { calculateEmergencyKeyCount, getDesktopRedeemConflict, getNextDesktopPeriodWindow } from '@/lib/desktop-license-domain'
import {
  DESKTOP_GRANT_TTL_MS,
  DESKTOP_INITIAL_KEY_COUNT,
  DESKTOP_MAX_KEY_COUNT,
  DESKTOP_PERIOD_DAYS,
  DESKTOP_PERIOD_QUOTA,
  DESKTOP_RESERVATION_LIMIT,
  DESKTOP_RESERVATION_TTL_MS,
  type DesktopGrantKind,
  type DesktopLicenseView,
} from '@/lib/desktop-license-types'

const PERIOD_MS = DESKTOP_PERIOD_DAYS * 24 * 60 * 60 * 1000

export class DesktopLicenseError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message)
  }
}

function getDb(database: D1Database) {
  return drizzle(database, { schema })
}

function toIso(value: Date | null): string | null {
  return value ? value.toISOString() : null
}

function assertDeviceId(deviceId: string): void {
  if (!/^[A-Za-z0-9_-]{32,160}$/.test(deviceId)) {
    throw new DesktopLicenseError('设备标识格式无效', 400, 'INVALID_DEVICE_ID')
  }
}

export async function cleanupExpiredDesktopState(database: D1Database): Promise<void> {
  const db = getDb(database)
  const now = new Date()
  const expiredGrants = await db.select().from(desktopActivationGrants).where(and(
    eq(desktopActivationGrants.status, 'issued'),
    lte(desktopActivationGrants.expiresAt, now),
  ))

  for (const grant of expiredGrants) {
    if (grant.kind !== 'new') {
      await db.update(desktopActivationGrants)
        .set({ status: 'expired' })
        .where(and(eq(desktopActivationGrants.id, grant.id), eq(desktopActivationGrants.status, 'issued')))
      continue
    }

    const bindings = await db.select({ poolKeyId: desktopLicenseKeys.poolKeyId })
      .from(desktopLicenseKeys)
      .where(eq(desktopLicenseKeys.licenseId, grant.licenseId))
    const statements = bindings.map(({ poolKeyId }) => database.prepare(
      "UPDATE tinypng_key_pool SET status = 'active', updated_at = ? WHERE id = ? AND status = 'reserved'",
    ).bind(Date.now(), poolKeyId))
    statements.push(
      database.prepare('DELETE FROM desktop_license_keys WHERE license_id = ?').bind(grant.licenseId),
      database.prepare('DELETE FROM desktop_licenses WHERE id = ? AND status = ?').bind(grant.licenseId, 'pending'),
      database.prepare("UPDATE desktop_activation_grants SET status = 'expired' WHERE id = ? AND status = 'issued'").bind(grant.id),
    )
    await database.batch(statements)
  }

  const expiredReservations = await db.select().from(desktopUsageReservations).where(and(
    eq(desktopUsageReservations.status, 'active'),
    lte(desktopUsageReservations.expiresAt, now),
  ))
  for (const reservation of expiredReservations) {
    const completedAt = Date.now()
    await database.batch([
      database.prepare(
        "UPDATE desktop_license_periods SET reserved_count = MAX(0, reserved_count - ?) WHERE id = ? AND EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = ? AND status = 'active')",
      ).bind(reservation.requestedCount, reservation.periodId, reservation.id),
      database.prepare(
        "UPDATE desktop_usage_reservations SET status = 'expired', completed_at = ? WHERE id = ? AND status = 'active'",
      ).bind(completedAt, reservation.id),
    ])
  }
}

async function insertNewGrantWithReservedKeys(
  database: D1Database,
  grant: { id: string; licenseId: string; codeHash: string; expiresAt: Date },
): Promise<void> {
  const db = getDb(database)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const available = await db.select({ id: tinypngKeyPool.id })
      .from(tinypngKeyPool)
      .where(and(eq(tinypngKeyPool.status, 'active'), gt(tinypngKeyPool.apiKey, '')))
      .limit(DESKTOP_INITIAL_KEY_COUNT)

    if (available.length < DESKTOP_INITIAL_KEY_COUNT) {
      throw new DesktopLicenseError('TinyPNG Pool 可用容量不足，至少需要 40 个 Key', 409, 'POOL_CAPACITY_INSUFFICIENT')
    }

    const now = Date.now()
    const statements = [
      database.prepare(
        "INSERT INTO desktop_licenses (id, status, key_limit, created_at, updated_at) VALUES (?, 'pending', ?, ?, ?)",
      ).bind(grant.licenseId, DESKTOP_MAX_KEY_COUNT, now, now),
      database.prepare(
        "INSERT INTO desktop_activation_grants (id, license_id, kind, code_hash, status, expires_at, created_at) VALUES (?, ?, 'new', ?, 'issued', ?, ?)",
      ).bind(grant.id, grant.licenseId, grant.codeHash, grant.expiresAt.getTime(), now),
      ...available.flatMap(({ id }) => [
      database.prepare(
        "UPDATE tinypng_key_pool SET status = 'reserved', updated_at = ? WHERE id = ? AND status = 'active'",
      ).bind(now, id),
      database.prepare(
        'INSERT INTO desktop_license_keys (license_id, pool_key_id, is_emergency, assigned_at) VALUES (?, ?, 0, ?)',
      ).bind(grant.licenseId, id, now),
      ]),
    ]

    try {
      await database.batch(statements)
      return
    } catch (error) {
      if (attempt === 2) throw error
    }
  }
}

export async function createDesktopGrant(
  database: D1Database,
  kind: DesktopGrantKind,
  targetLicenseId?: string,
): Promise<{ code: string; licenseId: string; expiresAt: Date }> {
  await cleanupExpiredDesktopState(database)
  const db = getDb(database)
  const now = new Date()
  const expiresAt = new Date(now.getTime() + DESKTOP_GRANT_TTL_MS)
  const code = createDesktopSecret(30)
  const codeHash = await sha256Hex(code)
  const grantId = crypto.randomUUID()
  const licenseId = kind === 'new' ? crypto.randomUUID() : targetLicenseId

  if (!licenseId) {
    throw new DesktopLicenseError('续费或换机必须指定授权', 400, 'LICENSE_REQUIRED')
  }

  if (kind === 'new') {
    await insertNewGrantWithReservedKeys(database, {
      id: grantId,
      licenseId,
      codeHash,
      expiresAt,
    })
  } else {
    const license = await db.select().from(desktopLicenses).where(eq(desktopLicenses.id, licenseId)).get()
    if (!license || license.status !== 'active') {
      throw new DesktopLicenseError('授权不存在或不可用', 404, 'LICENSE_NOT_ACTIVE')
    }
    await db.insert(desktopActivationGrants).values({
      id: grantId,
      licenseId,
      kind,
      codeHash,
      expiresAt,
    })
  }

  return { code, licenseId, expiresAt }
}

export async function getDesktopLicenseView(
  database: D1Database,
  licenseId: string,
): Promise<DesktopLicenseView> {
  const db = getDb(database)
  const license = await db.select().from(desktopLicenses).where(eq(desktopLicenses.id, licenseId)).get()
  if (!license) throw new DesktopLicenseError('授权不存在', 404, 'LICENSE_NOT_FOUND')

  const periods = await db.select().from(desktopLicensePeriods)
    .where(eq(desktopLicensePeriods.licenseId, licenseId))
    .orderBy(asc(desktopLicensePeriods.startsAt))
  const now = Date.now()
  const current = periods.find((period) => period.startsAt.getTime() <= now && period.expiresAt.getTime() > now)
  const scheduled = periods.filter((period) => period.startsAt.getTime() > now)

  let status: DesktopLicenseView['status']
  if (license.status === 'revoked') status = 'revoked'
  else if (license.status === 'pending') status = 'pending'
  else if (!current) status = scheduled.length > 0 ? 'pending' : 'expired'
  else status = current.usedCount >= current.quotaTotal ? 'exhausted' : 'active'

  return {
    id: license.id,
    status,
    used: current?.usedCount ?? periods.at(-1)?.usedCount ?? 0,
    limit: current?.quotaTotal ?? DESKTOP_PERIOD_QUOTA,
    startsAt: toIso(current?.startsAt ?? null),
    expiresAt: toIso(current?.expiresAt ?? periods.at(-1)?.expiresAt ?? null),
    scheduledPeriods: scheduled.map((period) => ({
      startsAt: period.startsAt.toISOString(),
      expiresAt: period.expiresAt.toISOString(),
    })),
  }
}

async function getLicenseKeys(database: D1Database, licenseId: string): Promise<string[]> {
  const db = getDb(database)
  const rows = await db.select({ apiKey: tinypngKeyPool.apiKey })
    .from(desktopLicenseKeys)
    .innerJoin(tinypngKeyPool, eq(desktopLicenseKeys.poolKeyId, tinypngKeyPool.id))
    .where(eq(desktopLicenseKeys.licenseId, licenseId))
  return rows.flatMap(({ apiKey }) => apiKey ? [apiKey] : [])
}

export async function redeemDesktopGrant(
  database: D1Database,
  code: string,
  deviceId: string,
): Promise<{ accessToken: string; license: DesktopLicenseView; apiKeys: string[] }> {
  assertDeviceId(deviceId)
  await cleanupExpiredDesktopState(database)
  const db = getDb(database)
  const codeHash = await sha256Hex(code)
  const grant = await db.select().from(desktopActivationGrants)
    .where(and(eq(desktopActivationGrants.codeHash, codeHash), eq(desktopActivationGrants.status, 'issued')))
    .get()

  if (!grant) {
    throw new DesktopLicenseError('授权码无效或已过期', 410, 'GRANT_EXPIRED')
  }

  const license = await db.select().from(desktopLicenses).where(eq(desktopLicenses.id, grant.licenseId)).get()
  if (!license) {
    throw new DesktopLicenseError('授权不存在或已撤销', 410, 'LICENSE_REVOKED')
  }
  const conflict = getDesktopRedeemConflict({
    kind: grant.kind,
    grantStatus: grant.status,
    expiresAtMs: grant.expiresAt.getTime(),
    nowMs: Date.now(),
    licenseStatus: license.status,
    boundDeviceId: license.deviceId,
    requestDeviceId: deviceId,
  })
  if (conflict) {
    const errors = {
      GRANT_EXPIRED: ['授权码无效或已过期', 410],
      LICENSE_REVOKED: ['授权不存在或已撤销', 410],
      GRANT_ALREADY_REDEEMED: ['授权已被兑换', 409],
      DEVICE_CONFLICT: ['续费码只能在原绑定设备上使用', 409],
    } as const
    throw new DesktopLicenseError(errors[conflict][0], errors[conflict][1], conflict)
  }

  const claimed = await database.prepare(
    "UPDATE desktop_activation_grants SET status = 'redeemed', redeemed_at = ? WHERE id = ? AND status = 'issued' AND expires_at > ? RETURNING id",
  ).bind(Date.now(), grant.id, Date.now()).first<{ id: string }>()
  if (!claimed) throw new DesktopLicenseError('授权码已被兑换', 409, 'GRANT_ALREADY_REDEEMED')

  const accessToken = createDesktopSecret(36)
  const accessTokenHash = await sha256Hex(accessToken)
  const now = new Date()

  try {
    if (grant.kind === 'new') {
      const periodId = crypto.randomUUID()
      await database.batch([
        database.prepare(
          "UPDATE desktop_licenses SET status = 'active', device_id = ?, access_token_hash = ?, activated_at = ?, updated_at = ? WHERE id = ? AND status = 'pending'",
        ).bind(deviceId, accessTokenHash, now.getTime(), now.getTime(), license.id),
        database.prepare(
          'INSERT INTO desktop_license_periods (id, license_id, starts_at, expires_at, quota_total, used_count, reserved_count, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
        ).bind(periodId, license.id, now.getTime(), now.getTime() + PERIOD_MS, DESKTOP_PERIOD_QUOTA, now.getTime()),
        database.prepare(
          "UPDATE tinypng_key_pool SET status = 'assigned', updated_at = ? WHERE id IN (SELECT pool_key_id FROM desktop_license_keys WHERE license_id = ?) AND status = 'reserved'",
        ).bind(now.getTime(), license.id),
      ])
    } else if (grant.kind === 'renew') {
      const latest = await db.select().from(desktopLicensePeriods)
        .where(eq(desktopLicensePeriods.licenseId, license.id))
        .orderBy(desc(desktopLicensePeriods.expiresAt))
        .limit(1)
        .get()
      if (!latest) throw new DesktopLicenseError('授权周期数据缺失', 409, 'PERIOD_MISSING')
      const window = getNextDesktopPeriodWindow(now.getTime(), latest.expiresAt.getTime(), PERIOD_MS)
      await database.batch([
        database.prepare(
          'INSERT INTO desktop_license_periods (id, license_id, starts_at, expires_at, quota_total, used_count, reserved_count, created_at) VALUES (?, ?, ?, ?, ?, 0, 0, ?)',
        ).bind(crypto.randomUUID(), license.id, window.startsAt, window.expiresAt, DESKTOP_PERIOD_QUOTA, now.getTime()),
        database.prepare(
          'UPDATE desktop_licenses SET access_token_hash = ?, updated_at = ? WHERE id = ? AND status = ?',
        ).bind(accessTokenHash, now.getTime(), license.id, 'active'),
      ])
    } else {
      await db.update(desktopLicenses).set({
        deviceId,
        accessTokenHash,
        updatedAt: now,
      }).where(and(eq(desktopLicenses.id, license.id), eq(desktopLicenses.status, 'active')))
    }
  } catch (error) {
    await database.prepare(
      "UPDATE desktop_activation_grants SET status = 'issued', redeemed_at = NULL WHERE id = ? AND status = 'redeemed'",
    ).bind(grant.id).run()
    throw error
  }

  return {
    accessToken,
    license: await getDesktopLicenseView(database, license.id),
    apiKeys: await getLicenseKeys(database, license.id),
  }
}

export async function authenticateDesktopLicense(request: Request, database: D1Database) {
  const authorization = request.headers.get('authorization')
  const deviceId = request.headers.get('x-device-id')
  if (!authorization?.startsWith('Bearer ') || !deviceId) {
    throw new DesktopLicenseError('缺少桌面端凭证', 401, 'UNAUTHORIZED')
  }
  assertDeviceId(deviceId)
  const tokenHash = await sha256Hex(authorization.slice(7))
  const db = getDb(database)
  const license = await db.select().from(desktopLicenses).where(and(
    eq(desktopLicenses.accessTokenHash, tokenHash),
    eq(desktopLicenses.deviceId, deviceId),
  )).get()
  if (!license) throw new DesktopLicenseError('桌面端凭证无效', 401, 'UNAUTHORIZED')
  if (license.status === 'revoked') throw new DesktopLicenseError('授权已撤销', 403, 'LICENSE_REVOKED')
  if (license.status !== 'active') throw new DesktopLicenseError('授权尚未激活', 403, 'LICENSE_NOT_ACTIVE')
  return license
}

export async function createUsageReservation(
  request: Request,
  database: D1Database,
  requestedCount: number,
) {
  if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > DESKTOP_RESERVATION_LIMIT) {
    throw new DesktopLicenseError('单次预留数量必须为 1 到 20', 400, 'INVALID_RESERVATION_COUNT')
  }
  await cleanupExpiredDesktopState(database)
  const license = await authenticateDesktopLicense(request, database)
  const db = getDb(database)
  const now = new Date()
  const period = await db.select().from(desktopLicensePeriods).where(and(
    eq(desktopLicensePeriods.licenseId, license.id),
    lte(desktopLicensePeriods.startsAt, now),
    gt(desktopLicensePeriods.expiresAt, now),
  )).get()
  if (!period) throw new DesktopLicenseError('授权已过期', 403, 'LICENSE_EXPIRED')

  const id = crypto.randomUUID()
  const expiresAt = new Date(Date.now() + DESKTOP_RESERVATION_TTL_MS)
  await database.batch([
    database.prepare(
      "INSERT INTO desktop_usage_reservations (id, license_id, period_id, requested_count, status, expires_at, created_at) SELECT ?, ?, ?, ?, 'active', ?, ? WHERE EXISTS (SELECT 1 FROM desktop_license_periods WHERE id = ? AND used_count + reserved_count + ? <= quota_total)",
    ).bind(id, license.id, period.id, requestedCount, expiresAt.getTime(), Date.now(), period.id, requestedCount),
    database.prepare(
      'UPDATE desktop_license_periods SET reserved_count = reserved_count + ? WHERE id = ? AND EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = ?)',
    ).bind(requestedCount, period.id, id),
  ])
  const created = await db.select({ id: desktopUsageReservations.id })
    .from(desktopUsageReservations)
    .where(eq(desktopUsageReservations.id, id))
    .get()
  if (!created) throw new DesktopLicenseError('本授权周期额度不足', 409, 'QUOTA_EXHAUSTED')

  return { id, grantedCount: requestedCount, expiresAt: expiresAt.toISOString() }
}

export async function completeUsageReservation(
  request: Request,
  database: D1Database,
  reservationId: string,
  successCount: number,
) {
  const license = await authenticateDesktopLicense(request, database)
  const db = getDb(database)
  const reservation = await db.select().from(desktopUsageReservations).where(and(
    eq(desktopUsageReservations.id, reservationId),
    eq(desktopUsageReservations.licenseId, license.id),
  )).get()
  if (!reservation) throw new DesktopLicenseError('额度预留记录不存在', 404, 'RESERVATION_NOT_FOUND')
  if (!Number.isInteger(successCount) || successCount < 0 || successCount > reservation.requestedCount) {
    throw new DesktopLicenseError('成功数量超出预留范围', 400, 'INVALID_SUCCESS_COUNT')
  }
  if (reservation.status === 'completed') {
    return { reservationId, successCount: reservation.successCount ?? 0, license: await getDesktopLicenseView(database, license.id) }
  }
  if (reservation.status !== 'active') {
    throw new DesktopLicenseError('额度预留已失效', 409, 'RESERVATION_EXPIRED')
  }

  const completedAt = Date.now()
  await database.batch([
    database.prepare(
      "UPDATE desktop_license_periods SET used_count = MIN(quota_total, used_count + ?), reserved_count = MAX(0, reserved_count - ?) WHERE id = ? AND EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = ? AND status = 'active')",
    ).bind(successCount, reservation.requestedCount, reservation.periodId, reservationId),
    database.prepare(
      "UPDATE desktop_usage_reservations SET status = 'completed', success_count = ?, completed_at = ? WHERE id = ? AND status = 'active'",
    ).bind(successCount, completedAt, reservationId),
  ])

  const current = await db.select().from(desktopUsageReservations)
    .where(eq(desktopUsageReservations.id, reservationId))
    .get()
  if (current?.status !== 'completed') {
    throw new DesktopLicenseError('额度预留已失效', 409, 'RESERVATION_EXPIRED')
  }
  return {
    reservationId,
    successCount: current.successCount ?? 0,
    license: await getDesktopLicenseView(database, license.id),
  }
}

async function readTinifyCompressionCount(apiKey: string): Promise<{ count: number | null; invalid: boolean }> {
  try {
    const response = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(`api:${apiKey}`)}` },
      body: new Uint8Array(),
    })
    const value = response.headers.get('compression-count')
    return { count: value && /^\d+$/.test(value) ? Number(value) : null, invalid: response.status === 401 }
  } catch {
    return { count: null, invalid: false }
  }
}

export async function topUpDesktopKeys(request: Request, database: D1Database) {
  const license = await authenticateDesktopLicense(request, database)
  const view = await getDesktopLicenseView(database, license.id)
  if (view.status !== 'active') throw new DesktopLicenseError('当前授权不可补发 Key', 403, 'LICENSE_NOT_ACTIVE')
  const db = getDb(database)
  const bindings = await db.select({
    poolKeyId: desktopLicenseKeys.poolKeyId,
    apiKey: tinypngKeyPool.apiKey,
    isEmergency: desktopLicenseKeys.isEmergency,
  }).from(desktopLicenseKeys)
    .innerJoin(tinypngKeyPool, eq(desktopLicenseKeys.poolKeyId, tinypngKeyPool.id))
    .where(eq(desktopLicenseKeys.licenseId, license.id))

  const emergencyCount = bindings.filter((binding) => binding.isEmergency).length
  if (bindings.length >= DESKTOP_MAX_KEY_COUNT || emergencyCount >= DESKTOP_MAX_KEY_COUNT - DESKTOP_INITIAL_KEY_COUNT) {
    throw new DesktopLicenseError('应急 Key 已达到上限', 409, 'KEY_LIMIT_REACHED')
  }

  const usage = await Promise.all(bindings.map(async (binding) => ({
    ...binding,
    ...(binding.apiKey ? await readTinifyCompressionCount(binding.apiKey) : { count: null, invalid: true }),
  })))
  if (usage.some((item) => item.count === null && !item.invalid)) {
    throw new DesktopLicenseError('暂时无法核验 TinyPNG 真实用量，请稍后重试', 503, 'TINIFY_USAGE_UNAVAILABLE')
  }
  const invalidIds = usage.filter((item) => item.invalid).map((item) => item.poolKeyId)
  if (invalidIds.length > 0) {
    await db.update(tinypngKeyPool).set({ status: 'invalid', updatedAt: new Date() })
      .where(inArray(tinypngKeyPool.id, invalidIds))
  }

  const realRemaining = usage.reduce((sum, item) => sum + (item.count === null ? 0 : Math.max(0, 500 - item.count)), 0)
  const logicalRemaining = Math.max(0, view.limit - view.used)
  if (realRemaining >= logicalRemaining) return { apiKeys: [], reason: 'CAPACITY_AVAILABLE' as const }

  const required = calculateEmergencyKeyCount({
    logicalRemaining,
    realRemaining,
    assignedCount: bindings.length,
    emergencyCount,
  })
  const available = await db.select({ id: tinypngKeyPool.id, apiKey: tinypngKeyPool.apiKey })
    .from(tinypngKeyPool)
    .where(and(eq(tinypngKeyPool.status, 'active'), gt(tinypngKeyPool.apiKey, '')))
    .limit(required)
  if (available.length < required) {
    throw new DesktopLicenseError('服务容量暂时不足，请稍后重试', 503, 'POOL_CAPACITY_INSUFFICIENT')
  }

  const now = Date.now()
  try {
    await database.batch(available.flatMap(({ id }) => [
      database.prepare(
        "UPDATE tinypng_key_pool SET status = 'assigned', updated_at = ? WHERE id = ? AND status = 'active'",
      ).bind(now, id),
      database.prepare(
        'INSERT INTO desktop_license_keys (license_id, pool_key_id, is_emergency, assigned_at) VALUES (?, ?, 1, ?)',
      ).bind(license.id, id, now),
    ]))
  } catch {
    throw new DesktopLicenseError('Key 分配发生并发冲突，请重试', 409, 'KEY_ALLOCATION_CONFLICT')
  }

  return { apiKeys: available.flatMap(({ apiKey }) => apiKey ? [apiKey] : []), reason: 'TOPPED_UP' as const }
}

export async function listDesktopLicenses(database: D1Database) {
  const db = getDb(database)
  const licenses = await db.select().from(desktopLicenses).orderBy(desc(desktopLicenses.createdAt))
  return Promise.all(licenses.map(async (license) => {
    const [{ value: keyCount = 0 } = { value: 0 }] = await db.select({ value: count() })
      .from(desktopLicenseKeys)
      .where(eq(desktopLicenseKeys.licenseId, license.id))
    return {
      ...await getDesktopLicenseView(database, license.id),
      deviceBound: Boolean(license.deviceId),
      keyCount,
      createdAt: license.createdAt.toISOString(),
    }
  }))
}

export async function revokeDesktopLicense(database: D1Database, licenseId: string): Promise<void> {
  const db = getDb(database)
  const result = await db.update(desktopLicenses).set({
    status: 'revoked',
    accessTokenHash: null,
    updatedAt: new Date(),
  }).where(eq(desktopLicenses.id, licenseId)).returning({ id: desktopLicenses.id })
  if (result.length === 0) throw new DesktopLicenseError('授权不存在', 404, 'LICENSE_NOT_FOUND')
}
