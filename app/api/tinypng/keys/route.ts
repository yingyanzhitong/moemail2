import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeys } from "@/lib/schema"
import { NextResponse } from "next/server"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS } from "@/lib/permissions"
import { desc, eq } from "drizzle-orm"

export const runtime = "edge"

/**
 * GET: 获取用户的 TinyPNG API Keys 列表
 */
export async function GET() {
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
    const keys = await db.query.tinypngKeys.findMany({
      where: eq(tinypngKeys.userId, session.user.id),
      orderBy: desc(tinypngKeys.createdAt),
    })

    return NextResponse.json({
      tinypngKeys: keys.map(key => ({
        id: key.id,
        apiKey: key.apiKey,
        email: key.email,
        createdAt: key.createdAt,
      }))
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
