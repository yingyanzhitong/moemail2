import { getRequestContext } from "@cloudflare/next-on-pages"
import { auth, getUserRole } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngWorkerNodes } from "@/lib/schema"
import { parseEmailDomains } from "@/lib/tinypng-pool-domain"
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

  const { emailDomain, registrationMode, cronExpression, workerId } = await request.json() as {
    emailDomain?: string | null
    registrationMode?: unknown
    cronExpression?: unknown
    workerId?: string
  }

  if (workerId) {
    const worker = getTinyPngWorkerDefinition(workerId)
    if (worker?.role !== 'registrar') {
      return NextResponse.json({ error: "只能配置区域注册节点" }, { status: 400 })
    }
    if (emailDomain === undefined && registrationMode === undefined) {
      return NextResponse.json({ error: "请选择要保存的节点配置" }, { status: 400 })
    }

    let selectedDomain: string | null | undefined
    if (emailDomain !== undefined) {
      if (emailDomain !== null && typeof emailDomain !== 'string') {
        return NextResponse.json({ error: "邮箱域名格式无效" }, { status: 400 })
      }
      selectedDomain = emailDomain?.trim() || null
      const domains = parseEmailDomains(await getRequestContext().env.SITE_CONFIG.get("EMAIL_DOMAINS"))
      if (selectedDomain && !domains.includes(selectedDomain)) {
        return NextResponse.json({ error: "请选择已配置的邮箱域名" }, { status: 400 })
      }
    }

    if (registrationMode !== undefined && registrationMode !== 'proxy' && registrationMode !== 'direct') {
      return NextResponse.json({ error: "请选择有效的注册请求方式" }, { status: 400 })
    }

    await createDb().update(tinypngWorkerNodes)
      .set({
        ...(selectedDomain !== undefined ? { emailDomain: selectedDomain } : {}),
        ...(registrationMode !== undefined ? { registrationMode } : {}),
        updatedAt: new Date(),
      })
      .where(eq(tinypngWorkerNodes.id, workerId))

    return NextResponse.json({
      workerId,
      ...(selectedDomain !== undefined ? { emailDomain: selectedDomain } : {}),
      ...(registrationMode !== undefined ? { registrationMode } : {}),
    })
  }

  if (cronExpression === undefined) {
    return NextResponse.json({ error: "没有可保存的配置" }, { status: 400 })
  }

  const normalizedCronExpression = normalizeTinyPngPoolCronExpression(cronExpression)
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

  await getRequestContext().env.SITE_CONFIG.put(
    TINYPNG_POOL_CRON_CONFIG_KEY,
    normalizedCronExpression,
  )

  return NextResponse.json({
    cronExpression: normalizedCronExpression,
  })
}
