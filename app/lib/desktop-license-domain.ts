const DAY_MS = 24 * 60 * 60 * 1000

export function getDesktopPeriodExpiry(startAtMs: number, durationDays: number) {
  if (durationDays % 30 !== 0) return startAtMs + durationDays * DAY_MS

  const startAt = new Date(startAtMs)
  const targetMonth = startAt.getUTCMonth() + durationDays / 30
  const lastDayOfTargetMonth = new Date(Date.UTC(
    startAt.getUTCFullYear(),
    targetMonth + 1,
    0,
  )).getUTCDate()

  return Date.UTC(
    startAt.getUTCFullYear(),
    targetMonth,
    Math.min(startAt.getUTCDate(), lastDayOfTargetMonth),
    startAt.getUTCHours(),
    startAt.getUTCMinutes(),
    startAt.getUTCSeconds(),
    startAt.getUTCMilliseconds(),
  )
}

export function getNextDesktopPeriodWindow(nowMs: number, latestExpiresAtMs: number, durationDays: number) {
  const startsAt = Math.max(nowMs, latestExpiresAtMs)
  return { startsAt, expiresAt: getDesktopPeriodExpiry(startsAt, durationDays) }
}

export function calculateEmergencyKeyCount(input: {
  logicalRemaining: number
  realRemaining: number
  assignedCount: number
  emergencyCount: number
  maxAssigned?: number
  maxEmergency?: number
  perKeyCapacity?: number
}) {
  const maxAssigned = input.maxAssigned ?? 60
  const maxEmergency = input.maxEmergency ?? 20
  const perKeyCapacity = input.perKeyCapacity ?? 500
  const deficit = Math.max(0, input.logicalRemaining - input.realRemaining)
  const headroom = Math.max(0, Math.min(
    maxAssigned - input.assignedCount,
    maxEmergency - input.emergencyCount,
  ))
  return Math.min(headroom, Math.ceil(deficit / perKeyCapacity))
}

export function getDesktopRedeemConflict(input: {
  kind: 'new' | 'renew' | 'rebind'
  grantStatus: 'issued' | 'redeemed' | 'expired'
  expiresAtMs: number
  nowMs: number
  licenseStatus: 'pending' | 'active' | 'revoked'
  boundDeviceId: string | null
  requestDeviceId: string
}): 'GRANT_EXPIRED' | 'LICENSE_REVOKED' | 'GRANT_ALREADY_REDEEMED' | 'DEVICE_CONFLICT' | null {
  if (input.grantStatus !== 'issued' || input.expiresAtMs <= input.nowMs) return 'GRANT_EXPIRED'
  if (input.licenseStatus === 'revoked') return 'LICENSE_REVOKED'
  if (input.kind === 'new' && input.licenseStatus !== 'pending') return 'GRANT_ALREADY_REDEEMED'
  if (input.kind === 'renew' && input.boundDeviceId !== input.requestDeviceId) return 'DEVICE_CONFLICT'
  return null
}
