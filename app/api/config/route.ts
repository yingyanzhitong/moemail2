import { PERMISSIONS, Role, ROLES } from "@/lib/permissions"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { checkPermission } from "@/lib/auth"
import {
  EMAIL_ROLE_LIMIT_CONFIG_KEY,
  resolveRoleMaxEmails,
  parseRoleMaxEmails,
  type RoleEmailLimitConfig,
} from "@/lib/email-limits"
import {
  TINYPNG_DAILY_LIMIT_CONFIG_KEY,
  TINYPNG_PER_REQUEST_LIMIT_CONFIG_KEY,
  parseRoleTinyPngDailyLimits,
  parseRoleTinyPngPerRequestLimits,
  resolveRoleTinyPngDailyLimits,
  resolveRoleTinyPngPerRequestLimits,
  type RoleTinyPngDailyLimitConfig,
  type RoleTinyPngPerRequestLimitConfig,
} from "@/lib/tinypng-limits"

export const runtime = "edge"

export async function GET() {
  const env = getRequestContext().env
  const canManageConfig = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  const [
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    roleMaxEmails,
    tinypngDailyLimits,
    tinypngPerRequestLimits,
    turnstileEnabled,
    turnstileSiteKey,
    turnstileSecretKey,
  ] = await Promise.all([
    env.SITE_CONFIG.get("DEFAULT_ROLE"),
    env.SITE_CONFIG.get("EMAIL_DOMAINS"),
    env.SITE_CONFIG.get("ADMIN_CONTACT"),
    env.SITE_CONFIG.get("MAX_EMAILS"),
    env.SITE_CONFIG.get(EMAIL_ROLE_LIMIT_CONFIG_KEY),
    env.SITE_CONFIG.get(TINYPNG_DAILY_LIMIT_CONFIG_KEY),
    env.SITE_CONFIG.get(TINYPNG_PER_REQUEST_LIMIT_CONFIG_KEY),
    env.SITE_CONFIG.get("TURNSTILE_ENABLED"),
    env.SITE_CONFIG.get("TURNSTILE_SITE_KEY"),
    env.SITE_CONFIG.get("TURNSTILE_SECRET_KEY"),
  ])

  const resolvedRoleMaxEmails = parseRoleMaxEmails(roleMaxEmails, maxEmails)
  const resolvedTinyPngDailyLimits = parseRoleTinyPngDailyLimits(tinypngDailyLimits)
  const resolvedTinyPngPerRequestLimits =
    parseRoleTinyPngPerRequestLimits(tinypngPerRequestLimits)

  return Response.json({
    defaultRole: defaultRole || ROLES.CIVILIAN,
    emailDomains: emailDomains || process.env.DEFAULT_EMAIL_DOMAIN,
    adminContact: adminContact || "",
    maxEmails: resolvedRoleMaxEmails.civilian.toString(),
    roleMaxEmails: resolvedRoleMaxEmails,
    tinypngDailyLimits: resolvedTinyPngDailyLimits,
    tinypngPerRequestLimits: resolvedTinyPngPerRequestLimits,
    turnstile: canManageConfig
      ? {
          enabled: turnstileEnabled === "true",
          siteKey: turnstileSiteKey || "",
          secretKey: turnstileSecretKey || "",
        }
      : undefined,
  })
}

export async function POST(request: Request) {
  const canAccess = await checkPermission(PERMISSIONS.MANAGE_CONFIG)

  if (!canAccess) {
    return Response.json(
      {
        error: "权限不足",
      },
      { status: 403 },
    )
  }

  const {
    defaultRole,
    emailDomains,
    adminContact,
    maxEmails,
    roleMaxEmails,
    tinypngDailyLimits,
    tinypngPerRequestLimits,
    turnstile,
  } =
    (await request.json()) as {
      defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
      emailDomains: string
      adminContact: string
      maxEmails?: string
      roleMaxEmails?: Partial<Record<keyof RoleEmailLimitConfig, number | string>>
      tinypngDailyLimits?: Partial<Record<keyof RoleTinyPngDailyLimitConfig, number | string>>
      tinypngPerRequestLimits?: Partial<
        Record<keyof RoleTinyPngPerRequestLimitConfig, number | string>
      >
      turnstile?: {
        enabled: boolean
        siteKey: string
        secretKey: string
      }
    }

  if (![ROLES.DUKE, ROLES.KNIGHT, ROLES.CIVILIAN].includes(defaultRole)) {
    return Response.json({ error: "无效的角色" }, { status: 400 })
  }

  const turnstileConfig = turnstile ?? {
    enabled: false,
    siteKey: "",
    secretKey: "",
  }

  if (turnstileConfig.enabled && (!turnstileConfig.siteKey || !turnstileConfig.secretKey)) {
    return Response.json(
      { error: "Turnstile 启用时需要提供 Site Key 和 Secret Key" },
      { status: 400 },
    )
  }

  const resolvedRoleMaxEmails = resolveRoleMaxEmails(roleMaxEmails, maxEmails)
  const resolvedTinyPngDailyLimits = resolveRoleTinyPngDailyLimits(tinypngDailyLimits)
  const resolvedTinyPngPerRequestLimits =
    resolveRoleTinyPngPerRequestLimits(tinypngPerRequestLimits)
  const env = getRequestContext().env

  await Promise.all([
    env.SITE_CONFIG.put("DEFAULT_ROLE", defaultRole),
    env.SITE_CONFIG.put("EMAIL_DOMAINS", emailDomains),
    env.SITE_CONFIG.put("ADMIN_CONTACT", adminContact),
    env.SITE_CONFIG.put("MAX_EMAILS", resolvedRoleMaxEmails.civilian.toString()),
    env.SITE_CONFIG.put(EMAIL_ROLE_LIMIT_CONFIG_KEY, JSON.stringify(resolvedRoleMaxEmails)),
    env.SITE_CONFIG.put(
      TINYPNG_DAILY_LIMIT_CONFIG_KEY,
      JSON.stringify(resolvedTinyPngDailyLimits),
    ),
    env.SITE_CONFIG.put(
      TINYPNG_PER_REQUEST_LIMIT_CONFIG_KEY,
      JSON.stringify(resolvedTinyPngPerRequestLimits),
    ),
    env.SITE_CONFIG.put("TURNSTILE_ENABLED", turnstileConfig.enabled.toString()),
    env.SITE_CONFIG.put("TURNSTILE_SITE_KEY", turnstileConfig.siteKey),
    env.SITE_CONFIG.put("TURNSTILE_SECRET_KEY", turnstileConfig.secretKey),
  ])

  return Response.json({ success: true })
}
