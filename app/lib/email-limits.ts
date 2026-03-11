import { EMAIL_CONFIG } from "@/config"
import { ROLES, Role } from "@/lib/permissions"

export const ROLE_MAX_ACTIVE_EMAILS: Record<Role, number> = {
  [ROLES.EMPEROR]: 0,
  [ROLES.DUKE]: 1000,
  [ROLES.KNIGHT]: 100,
  [ROLES.CIVILIAN]: EMAIL_CONFIG.MAX_ACTIVE_EMAILS,
} as const

export function getMaxEmailsForRole(
  role?: Role | null,
  fallbackLimit: number = EMAIL_CONFIG.MAX_ACTIVE_EMAILS,
): number {
  if (!role) {
    return fallbackLimit
  }

  return ROLE_MAX_ACTIVE_EMAILS[role] ?? fallbackLimit
}

export function isUnlimitedEmailLimit(limit: number) {
  return limit <= 0
}
