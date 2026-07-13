export const DESKTOP_PERIOD_DAYS = 30
export const DESKTOP_PERIOD_QUOTA = 10_000
export const DESKTOP_INITIAL_KEY_COUNT = 40
export const DESKTOP_EMERGENCY_KEY_COUNT = 20
export const DESKTOP_MAX_GRANT_KEY_COUNT = 200
export const DESKTOP_MAX_PERIOD_QUOTA = 1_000_000
export const DESKTOP_MAX_PERIOD_DAYS = 365
export const DESKTOP_RESERVATION_LIMIT = 20
export const DESKTOP_GRANT_TTL_MS = 24 * 60 * 60 * 1000
export const DESKTOP_RESERVATION_TTL_MS = 2 * 60 * 60 * 1000

export type DesktopGrantKind = 'new' | 'renew' | 'rebind'

export interface DesktopGrantPlan {
  tokenCount: number
  compressionLimit: number
  durationDays: number
}

export interface DesktopLicenseView {
  id: string
  status: 'active' | 'pending' | 'expired' | 'exhausted' | 'revoked'
  used: number
  limit: number
  tokenCount: number
  startsAt: string | null
  expiresAt: string | null
  scheduledPeriods: Array<{
    startsAt: string
    expiresAt: string
  }>
}
