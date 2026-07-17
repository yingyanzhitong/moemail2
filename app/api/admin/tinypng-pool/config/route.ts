import { getRequestContext } from "@cloudflare/next-on-pages"
import { auth, getUserRole } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngWorkerNodes } from "@/lib/schema"
import { parseEmailDomains, TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY } from "@/lib/tinypng-pool-domain"
import { getTinyPngWorkerDefinition } from "@/lib/tinypng-pool-workers"
import {
  getNextTinyPngPoolRunAt,
  normalizeTinyPngPoolCronExpression,
  TINYPNG_POOL_CRON_CONFIG_KEY,
} from "@/lib/tinypng-pool-schedule"
import { ROLES } from "@/lib/permissions"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"

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

  const { emailDomain, cronExpression, workerId } = await request.json() as {
    emailDomain?: string | null
    cronExpression?: unknown
    workerId?: string
  }
  const env = getRequestContext().env
  const updates: Promise<void>[] = []
  let selectedDomain: string | null | undefined
  let normalizedCronExpression: string | undefined

  if (emailDomain !== undefined) {
    selectedDomain = emailDomain?.trim() || null
    const domains = parseEmailDomains(await env.SITE_CONFIG.get("EMAIL_DOMAINS"))

    if (selectedDomain && !domains.includes(selectedDomain)) {
      return NextResponse.json(
        { error: "请选择已配置的邮箱域名" },
        { status: 400 },
      )
    }

    if (!workerId && !selectedDomain) {
      return NextResponse.json(
        { error: "默认邮箱域名不能为空" },
        { status: 400 },
      )
    }
  }

  if (workerId) {
    const worker = getTinyPngWorkerDefinition(workerId)
    if (worker?.role !== 'registrar') {
      return NextResponse.json({ error: "只能配置区域注册节点" }, { status: 400 })
    }
    if (selectedDomain === undefined) {
      return NextResponse.json({ error: "请选择节点邮箱域名" }, { status: 400 })
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

  if (workerId) {
    await createDb().update(tinypngWorkerNodes)
      .set({ emailDomain: selectedDomain, updatedAt: new Date() })
      .where(eq(tinypngWorkerNodes.id, workerId))
  }

  if (!workerId && selectedDomain) {
    updates.push(env.SITE_CONFIG.put(TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY, selectedDomain))
  }
  if (normalizedCronExpression) {
    updates.push(env.SITE_CONFIG.put(
      TINYPNG_POOL_CRON_CONFIG_KEY,
      normalizedCronExpression,
    ))
  }
  if (updates.length === 0 && !workerId) {
    return NextResponse.json({ error: "没有可保存的配置" }, { status: 400 })
  }

  await Promise.all(updates)

  return NextResponse.json({
    ...(selectedDomain !== undefined ? { emailDomain: selectedDomain } : {}),
    ...(workerId ? { workerId } : {}),
    ...(normalizedCronExpression ? { cronExpression: normalizedCronExpression } : {}),
  })
}
