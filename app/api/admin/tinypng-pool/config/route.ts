import { getRequestContext } from "@cloudflare/next-on-pages"
import { auth, getUserRole } from "@/lib/auth"
import { parseEmailDomains, TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY } from "@/lib/tinypng-pool-domain"
import {
  getNextTinyPngPoolRunAt,
  normalizeTinyPngPoolCronExpression,
  TINYPNG_POOL_CRON_CONFIG_KEY,
} from "@/lib/tinypng-pool-schedule"
import { ROLES } from "@/lib/permissions"
import { NextResponse } from "next/server"

export const runtime = "edge"

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  const role = await getUserRole(session.user.id)
  if (role !== ROLES.EMPEROR) {
    return NextResponse.json({ error: "仅皇帝可配置 TinyPNG Pool" }, { status: 403 })
  }

  const { emailDomain, cronExpression } = await request.json() as {
    emailDomain?: string
    cronExpression?: unknown
  }
  const env = getRequestContext().env
  const updates: Promise<void>[] = []
  let selectedDomain: string | undefined
  let normalizedCronExpression: string | undefined

  if (emailDomain !== undefined) {
    selectedDomain = emailDomain.trim()
    const domains = parseEmailDomains(await env.SITE_CONFIG.get("EMAIL_DOMAINS"))

    if (!selectedDomain || !domains.includes(selectedDomain)) {
      return NextResponse.json(
        { error: "请选择已配置的邮箱域名" },
        { status: 400 },
      )
    }
  }

  if (cronExpression !== undefined) {
    normalizedCronExpression = normalizeTinyPngPoolCronExpression(cronExpression) ?? undefined
    if (!normalizedCronExpression) {
      return NextResponse.json(
        { error: "请输入有效的 5 段 Linux Cron 表达式" },
        { status: 400 },
      )
    }

    try {
      getNextTinyPngPoolRunAt(new Date(), normalizedCronExpression)
    } catch {
      return NextResponse.json(
        { error: "该 Cron 表达式在未来 5 年内没有可执行时间" },
        { status: 400 },
      )
    }
  }

  if (selectedDomain) {
    updates.push(env.SITE_CONFIG.put(TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY, selectedDomain))
  }
  if (normalizedCronExpression) {
    updates.push(env.SITE_CONFIG.put(
      TINYPNG_POOL_CRON_CONFIG_KEY,
      normalizedCronExpression,
    ))
  }
  if (updates.length === 0) {
    return NextResponse.json({ error: "没有可保存的配置" }, { status: 400 })
  }

  await Promise.all(updates)

  return NextResponse.json({
    ...(selectedDomain ? { emailDomain: selectedDomain } : {}),
    ...(normalizedCronExpression ? { cronExpression: normalizedCronExpression } : {}),
  })
}
