import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'

function database() {
  const db = new DatabaseSync(':memory:')
  db.exec('PRAGMA foreign_keys = ON')
  db.exec(`CREATE TABLE tinypng_key_pool (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT NOT NULL UNIQUE,
    api_key TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error_message TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`)
  db.exec(readFileSync(new URL('../drizzle/0026_desktop-licenses.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('../drizzle/0027_dynamic-desktop-grants.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('../drizzle/0028_brainy_callisto.sql', import.meta.url), 'utf8'))
  return db
}

function seedKeys(db, count) {
  const insert = db.prepare("INSERT INTO tinypng_key_pool VALUES (?, ?, ?, 'active', NULL, 1, 1)")
  for (let index = 0; index < count; index += 1) insert.run(`key-${index}`, `user-${index}@example.test`, `api-${index}`)
}

function issueNewGrant(db, licenseId, keyCount = 40, quotaTotal = 10000, durationDays = 30) {
  const available = db.prepare("SELECT id FROM tinypng_key_pool WHERE status = 'active' LIMIT ?").all(keyCount)
  if (available.length !== keyCount) throw new Error('POOL_CAPACITY_INSUFFICIENT')
  db.exec('BEGIN IMMEDIATE')
  try {
    db.prepare("INSERT INTO desktop_licenses (id, status, device_id, access_token_hash, key_limit, created_at, activated_at, updated_at, initial_key_count) VALUES (?, 'pending', NULL, NULL, ?, 1, NULL, 1, ?)").run(licenseId, keyCount + 20, keyCount)
    db.prepare("INSERT INTO desktop_activation_grants (id, license_id, kind, code_hash, status, expires_at, redeemed_at, created_at, token_count, quota_total, duration_days) VALUES (?, ?, 'new', ?, 'issued', 1000, NULL, 1, ?, ?, ?)").run(`grant-${licenseId}`, licenseId, `hash-${licenseId}`, keyCount, quotaTotal, durationDays)
    for (const { id } of available) {
      db.prepare("UPDATE tinypng_key_pool SET status = 'reserved' WHERE id = ? AND status = 'active'").run(id)
      db.prepare('INSERT INTO desktop_license_keys VALUES (?, ?, 0, 1)').run(licenseId, id)
    }
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

function stopLicense(db, licenseId) {
  const license = db.prepare('SELECT status FROM desktop_licenses WHERE id = ?').get(licenseId)
  if (!license) return

  db.exec('BEGIN IMMEDIATE')
  try {
    if (license.status === 'pending') {
      db.prepare("UPDATE tinypng_key_pool SET status = 'active' WHERE status = 'reserved' AND id IN (SELECT pool_key_id FROM desktop_license_keys WHERE license_id = ?)").run(licenseId)
      db.prepare('DELETE FROM desktop_license_keys WHERE license_id = ?').run(licenseId)
    }
    db.prepare("UPDATE desktop_activation_grants SET status = 'expired' WHERE license_id = ? AND status = 'issued'").run(licenseId)
    db.prepare("UPDATE desktop_licenses SET status = 'revoked', access_token_hash = NULL WHERE id = ?").run(licenseId)
    db.exec('COMMIT')
  } catch (error) {
    db.exec('ROLLBACK')
    throw error
  }
}

test('新授权原子预留 40 个 Key，Pool 不足时不残留授权', () => {
  const db = database()
  seedKeys(db, 59)
  issueNewGrant(db, 'license-a')
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tinypng_key_pool WHERE status = 'reserved'").get().count, 40)
  assert.throws(() => issueNewGrant(db, 'license-b'), /POOL_CAPACITY_INSUFFICIENT/)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM desktop_licenses").get().count, 1)
})

test('Auth Link grant 保存动态 Token、压缩额度和有效天数', () => {
  const db = database()
  seedKeys(db, 12)
  issueNewGrant(db, 'license-dynamic', 12, 3456, 45)
  const grant = db.prepare("SELECT token_count tokenCount, quota_total quotaTotal, duration_days durationDays FROM desktop_activation_grants WHERE license_id = 'license-dynamic'").get()
  assert.deepEqual({ ...grant }, { tokenCount: 12, quotaTotal: 3456, durationDays: 45 })
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tinypng_key_pool WHERE status = 'reserved'").get().count, 12)
})

test('旧 Auth Link 可原地轮换密文且不延长失效时间', () => {
  const db = database()
  seedKeys(db, 1)
  issueNewGrant(db, 'license-legacy', 1)

  const rotated = db.prepare("UPDATE desktop_activation_grants SET code_hash = ?, code_ciphertext = ? WHERE id = ? AND code_hash = ? AND status = 'issued' AND expires_at > ? RETURNING expires_at expiresAt")
    .get('rotated-hash', 'encrypted-code', 'grant-license-legacy', 'hash-license-legacy', 999)
  assert.equal(rotated.expiresAt, 1000)
  assert.equal(
    db.prepare("UPDATE desktop_activation_grants SET code_hash = 'racing-hash' WHERE id = ? AND code_hash = ? AND status = 'issued' RETURNING id")
      .get('grant-license-legacy', 'hash-license-legacy'),
    undefined,
  )
  assert.deepEqual(
    { ...db.prepare("SELECT code_hash codeHash, code_ciphertext codeCiphertext FROM desktop_activation_grants WHERE id = 'grant-license-legacy'").get() },
    { codeHash: 'rotated-hash', codeCiphertext: 'encrypted-code' },
  )
})

test('同一个 Pool Key 不能绑定两个授权', () => {
  const db = database()
  seedKeys(db, 40)
  issueNewGrant(db, 'license-a')
  db.prepare("INSERT INTO desktop_licenses (id, status, device_id, access_token_hash, key_limit, created_at, activated_at, updated_at, initial_key_count) VALUES ('license-b', 'pending', NULL, NULL, 60, 1, NULL, 1, 40)").run()
  assert.throws(() => db.prepare("INSERT INTO desktop_license_keys VALUES ('license-b', 'key-0', 0, 1)").run(), /UNIQUE/)
})

test('兑换使用条件更新保证一次性', () => {
  const db = database()
  seedKeys(db, 40)
  issueNewGrant(db, 'license-a')
  const claim = db.prepare("UPDATE desktop_activation_grants SET status = 'redeemed' WHERE id = ? AND status = 'issued' AND expires_at > ? RETURNING id")
  assert.equal(claim.get('grant-license-a', 10).id, 'grant-license-a')
  assert.equal(claim.get('grant-license-a', 10), undefined)
})

test('额度条件更新不会超卖，结算只累计成功数', () => {
  const db = database()
  seedKeys(db, 40)
  issueNewGrant(db, 'license-a')
  db.prepare("INSERT INTO desktop_license_periods VALUES ('period', 'license-a', 1, 1000, 10000, 9990, 0, 1)").run()
  const reserve = (id, count) => {
    db.exec('BEGIN IMMEDIATE')
    db.prepare("INSERT INTO desktop_usage_reservations (id, license_id, period_id, requested_count, status, expires_at, created_at) SELECT ?, 'license-a', 'period', ?, 'active', 1000, 1 WHERE EXISTS (SELECT 1 FROM desktop_license_periods WHERE id = 'period' AND used_count + reserved_count + ? <= quota_total)").run(id, count, count)
    db.prepare("UPDATE desktop_license_periods SET reserved_count = reserved_count + ? WHERE id = 'period' AND EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = ?)").run(count, id)
    db.exec('COMMIT')
    return Boolean(db.prepare('SELECT id FROM desktop_usage_reservations WHERE id = ?').get(id))
  }
  assert.equal(reserve('reservation', 10), true)
  assert.equal(reserve('overflow', 1), false)
  const complete = (successCount) => {
    db.exec('BEGIN IMMEDIATE')
    db.prepare("UPDATE desktop_license_periods SET used_count = used_count + ?, reserved_count = reserved_count - 10 WHERE id = 'period' AND EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = 'reservation' AND status = 'active')").run(successCount)
    db.prepare("UPDATE desktop_usage_reservations SET status = 'completed', success_count = ? WHERE id = 'reservation' AND status = 'active'").run(successCount)
    db.exec('COMMIT')
  }
  complete(7)
  complete(9)
  const period = db.prepare("SELECT used_count used, reserved_count reserved FROM desktop_license_periods WHERE id = 'period'").get()
  assert.equal(period.used, 9997)
  assert.equal(period.reserved, 0)
  assert.equal(db.prepare("SELECT success_count count FROM desktop_usage_reservations WHERE id = 'reservation'").get().count, 7)
})

test('客户端压缩用量回传按批次标识幂等累计', () => {
  const db = database()
  seedKeys(db, 40)
  issueNewGrant(db, 'license-a')
  db.prepare("INSERT INTO desktop_license_periods VALUES ('period', 'license-a', 1, 1000, 10000, 5, 0, 1)").run()

  const report = () => {
    db.exec('BEGIN IMMEDIATE')
    db.prepare("INSERT INTO desktop_usage_reservations (id, license_id, period_id, requested_count, status, expires_at, created_at) SELECT 'usage-report', 'license-a', 'period', 10, 'active', 1000, 1 WHERE NOT EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = 'usage-report')").run()
    db.prepare("UPDATE desktop_license_periods SET used_count = MIN(quota_total, used_count + 7) WHERE id = 'period' AND EXISTS (SELECT 1 FROM desktop_usage_reservations WHERE id = 'usage-report' AND license_id = 'license-a' AND status = 'active')").run()
    db.prepare("UPDATE desktop_usage_reservations SET status = 'completed', success_count = 7, completed_at = 2 WHERE id = 'usage-report' AND license_id = 'license-a' AND status = 'active'").run()
    db.exec('COMMIT')
  }

  report()
  report()
  assert.equal(db.prepare("SELECT used_count used FROM desktop_license_periods WHERE id = 'period'").get().used, 12)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM desktop_usage_reservations WHERE id = 'usage-report'").get().count, 1)
})

test('停止已激活授权会清除访问令牌，但已下发 Token 永不回池', () => {
  const db = database()
  seedKeys(db, 40)
  issueNewGrant(db, 'license-a')
  db.prepare("UPDATE desktop_licenses SET status = 'active', access_token_hash = 'token' WHERE id = 'license-a'").run()
  db.prepare("UPDATE tinypng_key_pool SET status = 'assigned' WHERE status = 'reserved'").run()
  stopLicense(db, 'license-a')
  assert.equal(db.prepare("SELECT access_token_hash token FROM desktop_licenses WHERE id = 'license-a'").get().token, null)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tinypng_key_pool WHERE status = 'assigned'").get().count, 40)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM desktop_license_keys WHERE license_id = 'license-a'").get().count, 40)
})

test('停止未兑换授权会使 Auth Link 失效并释放预留 Token', () => {
  const db = database()
  seedKeys(db, 12)
  issueNewGrant(db, 'license-pending', 12, 3456, 45)
  stopLicense(db, 'license-pending')

  assert.equal(db.prepare("SELECT status FROM desktop_licenses WHERE id = 'license-pending'").get().status, 'revoked')
  assert.equal(db.prepare("SELECT status FROM desktop_activation_grants WHERE license_id = 'license-pending'").get().status, 'expired')
  assert.equal(db.prepare("SELECT COUNT(*) count FROM desktop_license_keys WHERE license_id = 'license-pending'").get().count, 0)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM tinypng_key_pool WHERE status = 'active'").get().count, 12)
})
