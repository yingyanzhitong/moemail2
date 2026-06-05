import { ROLES, type Role } from "@/lib/permissions"

export const TINYPNG_DAILY_LIMIT_CONFIG_KEY = "TINYPNG_DAILY_ROLE_LIMITS"
export const TINYPNG_PER_REQUEST_LIMIT_CONFIG_KEY = "TINYPNG_PER_REQUEST_ROLE_LIMITS"

// TinyPNG API Key 生成限制配置
export interface TinyPngLimitConfig {
  perRequest: number  // 每次请求最多生成数量，0 表示无限制
  perDay: number      // 每天最多生成数量，0 表示无限制
}

export const CONFIGURABLE_TINYPNG_DAILY_LIMIT_ROLES = [
  ROLES.DUKE,
  ROLES.KNIGHT,
  ROLES.CIVILIAN,
] as const

export type ConfigurableTinyPngDailyLimitRole =
  typeof CONFIGURABLE_TINYPNG_DAILY_LIMIT_ROLES[number]

export type RoleTinyPngDailyLimitConfig = Record<ConfigurableTinyPngDailyLimitRole, number>
export type RoleTinyPngPerRequestLimitConfig = Record<Role, number>

export const TINYPNG_KEY_LIMITS: Record<Role, TinyPngLimitConfig> = {
  [ROLES.EMPEROR]: { perRequest: 0, perDay: 0 },      // 皇帝无限制
  [ROLES.DUKE]: { perRequest: 10, perDay: 50 },       // 公爵每次10个，每天50个
  [ROLES.KNIGHT]: { perRequest: 5, perDay: 20 },      // 骑士每次5个，每天20个
  [ROLES.CIVILIAN]: { perRequest: 0, perDay: 0 },     // 平民无权限
}

export const DEFAULT_TINYPNG_DAILY_LIMITS: RoleTinyPngDailyLimitConfig = {
  [ROLES.DUKE]: TINYPNG_KEY_LIMITS[ROLES.DUKE].perDay,
  [ROLES.KNIGHT]: TINYPNG_KEY_LIMITS[ROLES.KNIGHT].perDay,
  [ROLES.CIVILIAN]: TINYPNG_KEY_LIMITS[ROLES.CIVILIAN].perDay,
}

export const DEFAULT_TINYPNG_PER_REQUEST_LIMITS: RoleTinyPngPerRequestLimitConfig = {
  [ROLES.EMPEROR]: TINYPNG_KEY_LIMITS[ROLES.EMPEROR].perRequest,
  [ROLES.DUKE]: TINYPNG_KEY_LIMITS[ROLES.DUKE].perRequest,
  [ROLES.KNIGHT]: TINYPNG_KEY_LIMITS[ROLES.KNIGHT].perRequest,
  [ROLES.CIVILIAN]: TINYPNG_KEY_LIMITS[ROLES.CIVILIAN].perRequest,
}

function normalizeNonNegativeLimit(value: unknown, fallbackValue: number) {
  const parsedValue = Number(value)

  if (Number.isFinite(parsedValue) && parsedValue >= 0) {
    return Math.floor(parsedValue)
  }

  return fallbackValue
}

export function resolveRoleTinyPngDailyLimits(
  roleLimits?: Partial<Record<ConfigurableTinyPngDailyLimitRole, unknown>> | null,
): RoleTinyPngDailyLimitConfig {
  return {
    [ROLES.DUKE]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.DUKE],
      DEFAULT_TINYPNG_DAILY_LIMITS[ROLES.DUKE],
    ),
    [ROLES.KNIGHT]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.KNIGHT],
      DEFAULT_TINYPNG_DAILY_LIMITS[ROLES.KNIGHT],
    ),
    [ROLES.CIVILIAN]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.CIVILIAN],
      DEFAULT_TINYPNG_DAILY_LIMITS[ROLES.CIVILIAN],
    ),
  }
}

export function parseRoleTinyPngDailyLimits(
  rawRoleLimits?: string | null,
): RoleTinyPngDailyLimitConfig {
  if (!rawRoleLimits) {
    return resolveRoleTinyPngDailyLimits()
  }

  try {
    const parsedRoleLimits = JSON.parse(rawRoleLimits) as Partial<
      Record<ConfigurableTinyPngDailyLimitRole, unknown>
    >

    return resolveRoleTinyPngDailyLimits(parsedRoleLimits)
  } catch {
    return resolveRoleTinyPngDailyLimits()
  }
}

export function resolveRoleTinyPngPerRequestLimits(
  roleLimits?: Partial<Record<Role, unknown>> | null,
): RoleTinyPngPerRequestLimitConfig {
  return {
    [ROLES.EMPEROR]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.EMPEROR],
      DEFAULT_TINYPNG_PER_REQUEST_LIMITS[ROLES.EMPEROR],
    ),
    [ROLES.DUKE]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.DUKE],
      DEFAULT_TINYPNG_PER_REQUEST_LIMITS[ROLES.DUKE],
    ),
    [ROLES.KNIGHT]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.KNIGHT],
      DEFAULT_TINYPNG_PER_REQUEST_LIMITS[ROLES.KNIGHT],
    ),
    [ROLES.CIVILIAN]: normalizeNonNegativeLimit(
      roleLimits?.[ROLES.CIVILIAN],
      DEFAULT_TINYPNG_PER_REQUEST_LIMITS[ROLES.CIVILIAN],
    ),
  }
}

export function parseRoleTinyPngPerRequestLimits(
  rawRoleLimits?: string | null,
): RoleTinyPngPerRequestLimitConfig {
  if (!rawRoleLimits) {
    return resolveRoleTinyPngPerRequestLimits()
  }

  try {
    const parsedRoleLimits = JSON.parse(rawRoleLimits) as Partial<Record<Role, unknown>>

    return resolveRoleTinyPngPerRequestLimits(parsedRoleLimits)
  } catch {
    return resolveRoleTinyPngPerRequestLimits()
  }
}

export function getTinyPngLimitConfigForRole(
  role: Role,
  dailyLimits?: Partial<Record<ConfigurableTinyPngDailyLimitRole, unknown>> | null,
  perRequestLimits?: Partial<Record<Role, unknown>> | null,
): TinyPngLimitConfig {
  const defaultLimit = TINYPNG_KEY_LIMITS[role] ?? TINYPNG_KEY_LIMITS[ROLES.CIVILIAN]
  const resolvedPerRequestLimits = resolveRoleTinyPngPerRequestLimits(perRequestLimits)
  const perRequest = resolvedPerRequestLimits[role] ?? defaultLimit.perRequest

  if (!CONFIGURABLE_TINYPNG_DAILY_LIMIT_ROLES.includes(
    role as ConfigurableTinyPngDailyLimitRole,
  )) {
    return {
      ...defaultLimit,
      perRequest,
    }
  }

  const resolvedDailyLimits = resolveRoleTinyPngDailyLimits(dailyLimits)

  return {
    ...defaultLimit,
    perRequest,
    perDay: resolvedDailyLimits[role as ConfigurableTinyPngDailyLimitRole],
  }
}
