import { getRequestContext } from "@cloudflare/next-on-pages"
import { auth, getUserRole } from "@/lib/auth"
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

  const { cronExpression } = await request.json() as {
    cronExpression?: unknown
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
