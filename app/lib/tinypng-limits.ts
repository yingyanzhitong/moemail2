import { ROLES, type Role } from "@/lib/permissions"

// TinyPNG API Key 生成限制配置
export interface TinyPngLimitConfig {
  perRequest: number  // 每次请求最多生成数量，0 表示无限制
  perDay: number      // 每天最多生成数量，0 表示无限制
}

export const TINYPNG_KEY_LIMITS: Record<Role, TinyPngLimitConfig> = {
  [ROLES.EMPEROR]: { perRequest: 0, perDay: 0 },      // 皇帝无限制
  [ROLES.DUKE]: { perRequest: 10, perDay: 50 },       // 公爵每次10个，每天50个
  [ROLES.KNIGHT]: { perRequest: 5, perDay: 20 },      // 骑士每次5个，每天20个
  [ROLES.CIVILIAN]: { perRequest: 0, perDay: 0 },     // 平民无权限
}
