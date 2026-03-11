import { EMAIL_CONFIG } from "@/config"
import { ROLES, Role } from "@/lib/permissions"

export const EMAIL_ROLE_LIMIT_CONFIG_KEY = "EMAIL_MAX_ROLE_LIMITS"

export const CONFIGURABLE_EMAIL_LIMIT_ROLES = [
  ROLES.DUKE,
  ROLES.KNIGHT,
  ROLES.CIVILIAN,
] as const

export type ConfigurableEmailLimitRole = typeof CONFIGURABLE_EMAIL_LIMIT_ROLES[number]

export type RoleEmailLimitConfig = Record<ConfigurableEmailLimitRole, number>

export const DEFAULT_ROLE_MAX_ACTIVE_EMAILS: Record<Role, number> = {
  [ROLES.EMPEROR]: 0,
  [ROLES.DUKE]: 1000,
  [ROLES.KNIGHT]: 100,
  [ROLES.CIVILIAN]: EMAIL_CONFIG.MAX_ACTIVE_EMAILS,
} as const

function normalizePositiveLimit(value: unknown, fallbackValue: number) {
  const parsedValue = Number(value)

  if (Number.isFinite(parsedValue) && parsedValue > 0) {
    return Math.floor(parsedValue)
  }

  return fallbackValue
}

export function resolveRoleMaxEmails(
  roleLimits?: Partial<Record<ConfigurableEmailLimitRole, unknown>> | null,
  legacyCivilianLimit?: string | number | null,
): RoleEmailLimitConfig {
  const civilianFallback = normalizePositiveLimit(
    legacyCivilianLimit,
    DEFAULT_ROLE_MAX_ACTIVE_EMAILS[ROLES.CIVILIAN],
  )

  return {
    [ROLES.DUKE]: normalizePositiveLimit(
      roleLimits?.[ROLES.DUKE],
      DEFAULT_ROLE_MAX_ACTIVE_EMAILS[ROLES.DUKE],
    ),
    [ROLES.KNIGHT]: normalizePositiveLimit(
      roleLimits?.[ROLES.KNIGHT],
      DEFAULT_ROLE_MAX_ACTIVE_EMAILS[ROLES.KNIGHT],
    ),
    [ROLES.CIVILIAN]: normalizePositiveLimit(
      roleLimits?.[ROLES.CIVILIAN],
      civilianFallback,
    ),
  }
}

export function parseRoleMaxEmails(
  rawRoleLimits?: string | null,
  legacyCivilianLimit?: string | number | null,
): RoleEmailLimitConfig {
  if (!rawRoleLimits) {
    return resolveRoleMaxEmails(undefined, legacyCivilianLimit)
  }

  try {
    const parsedRoleLimits = JSON.parse(rawRoleLimits) as Partial<
      Record<ConfigurableEmailLimitRole, unknown>
    >

    return resolveRoleMaxEmails(parsedRoleLimits, legacyCivilianLimit)
  } catch {
    return resolveRoleMaxEmails(undefined, legacyCivilianLimit)
  }
}

export function getMaxEmailsForRole(
  role?: Role | null,
  roleLimits?: Partial<Record<ConfigurableEmailLimitRole, unknown>> | null,
  fallbackLimit: number = EMAIL_CONFIG.MAX_ACTIVE_EMAILS,
): number {
  if (role === ROLES.EMPEROR) {
    return DEFAULT_ROLE_MAX_ACTIVE_EMAILS[ROLES.EMPEROR]
  }

  const resolvedRoleLimits = resolveRoleMaxEmails(roleLimits, fallbackLimit)

  if (role === ROLES.DUKE) {
    return resolvedRoleLimits[ROLES.DUKE]
  }

  if (role === ROLES.KNIGHT) {
    return resolvedRoleLimits[ROLES.KNIGHT]
  }

  if (role === ROLES.CIVILIAN) {
    return resolvedRoleLimits[ROLES.CIVILIAN]
  }

  return normalizePositiveLimit(fallbackLimit, DEFAULT_ROLE_MAX_ACTIVE_EMAILS[ROLES.CIVILIAN])
}

export function isUnlimitedEmailLimit(limit: number) {
  return limit <= 0
}
