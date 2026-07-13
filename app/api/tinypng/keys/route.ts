import { auth, checkPermission } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeys, tinypngTaskRuns } from "@/lib/schema"
import { getNextTinyPngPoolRunAt, TINYPNG_POOL_SCHEDULE_LABEL } from "@/lib/tinypng-pool-schedule"
import { NextResponse } from "next/server"
import { PERMISSIONS } from "@/lib/permissions"
import { desc, eq, and } from "drizzle-orm"

export const runtime = "edge"

/**
 * GET: 获取用户的 TinyPNG API Keys 列表
 * 支持 ?email=xxx 查询单个 key
 */
export async function GET(request: Request) {
  const hasPermission = await checkPermission(PERMISSIONS.MANAGE_API_KEY)
  if (!hasPermission) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  try {
    const db = createDb()
    const url = new URL(request.url)
    const emailParam = url.searchParams.get("email")

    // 如果提供了 email 参数，查询单个 key
    if (emailParam) {
      const key = await db.query.tinypngKeys.findFirst({
        where: and(
          eq(tinypngKeys.userId, session.user.id),
          eq(tinypngKeys.email, emailParam)
        ),
      })

      if (!key) {
        return NextResponse.json({ error: "未找到对应的 API Key" }, { status: 404 })
      }

      return NextResponse.json({
        key: {
          id: key.id,
          apiKey: key.apiKey,
          email: key.email,
          createdAt: key.createdAt,
        }
      })
    }

    // 否则返回所有 keys
    const [keys, lastTaskRun] = await Promise.all([
      db.query.tinypngKeys.findMany({
        where: eq(tinypngKeys.userId, session.user.id),
        orderBy: desc(tinypngKeys.createdAt),
      }),
      db.query.tinypngTaskRuns.findFirst({
        orderBy: desc(tinypngTaskRuns.completedAt),
      }),
    ])

    return NextResponse.json({
      tinypngKeys: keys.map(key => ({
        id: key.id,
        apiKey: key.apiKey,
        email: key.email,
        createdAt: key.createdAt,
      })),
      taskStatus: {
        scheduleLabel: TINYPNG_POOL_SCHEDULE_LABEL,
        nextRunAt: getNextTinyPngPoolRunAt().toISOString(),
        lastRun: lastTaskRun ? {
          status: lastTaskRun.status,
          message: lastTaskRun.message,
          createdCount: lastTaskRun.createdCount,
          cleanedCount: lastTaskRun.cleanedCount,
          failedCount: lastTaskRun.failedCount,
          successfulCount: lastTaskRun.successfulCount,
          durationMs: Math.max(lastTaskRun.completedAt.getTime() - lastTaskRun.startedAt.getTime(), 0),
          completedAt: lastTaskRun.completedAt,
        } : null,
      },
    })
  } catch (error) {
    console.error("Failed to fetch TinyPNG keys:", error)
    return NextResponse.json(
      { error: "获取 TinyPNG API Keys 失败" },
      { status: 500 }
    )
  }
}

/**
 * DELETE: 删除指定的 TinyPNG API Key
 */
export async function DELETE(request: Request) {
  const hasPermission = await checkPermission(PERMISSIONS.MANAGE_API_KEY)
  if (!hasPermission) {
    return NextResponse.json({ error: "权限不足" }, { status: 403 })
  }

  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  try {
    const { id } = await request.json() as { id: string }
    if (!id) {
      return NextResponse.json({ error: "缺少 ID 参数" }, { status: 400 })
    }

    const db = createDb()
    
    // 验证是用户自己的 key
    const existingKey = await db.query.tinypngKeys.findFirst({
      where: eq(tinypngKeys.id, id),
    })

    if (!existingKey || existingKey.userId !== session.user.id) {
      return NextResponse.json({ error: "未找到该 Key" }, { status: 404 })
    }

    await db.delete(tinypngKeys).where(eq(tinypngKeys.id, id))

    return NextResponse.json({ success: true })
  } catch (error) {
    console.error("Failed to delete TinyPNG key:", error)
    return NextResponse.json(
      { error: "删除失败" },
      { status: 500 }
    )
  }
}
