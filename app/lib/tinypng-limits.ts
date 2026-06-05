import { ROLES, type Role } from "@/lib/permissions"

export const TINYPNG_DAILY_LIMIT_CONFIG_KEY = "TINYPNG_DAILY_ROLE_LIMITS"

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

export function getTinyPngLimitConfigForRole(
  role: Role,
  dailyLimits?: Partial<Record<ConfigurableTinyPngDailyLimitRole, unknown>> | null,
): TinyPngLimitConfig {
  const defaultLimit = TINYPNG_KEY_LIMITS[role] ?? TINYPNG_KEY_LIMITS[ROLES.CIVILIAN]

  if (!CONFIGURABLE_TINYPNG_DAILY_LIMIT_ROLES.includes(
    role as ConfigurableTinyPngDailyLimitRole,
  )) {
    return defaultLimit
  }

  const resolvedDailyLimits = resolveRoleTinyPngDailyLimits(dailyLimits)

  return {
    ...defaultLimit,
    perDay: resolvedDailyLimits[role as ConfigurableTinyPngDailyLimitRole],
  }
}
