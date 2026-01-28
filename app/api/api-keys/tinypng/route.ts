import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { apiKeys } from "@/lib/schema"
import { nanoid } from "nanoid"
import { NextResponse } from "next/server"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS } from "@/lib/permissions"
import { eq, and } from "drizzle-orm"

export const runtime = "edge"

const TINYPNG_API_KEY_NAME = "tinypng"

/**
 * GET: 获取用户的 tinypng 专用 API Key
 * 如果不存在则自动创建
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
    const userId = session.user.id

    // 查找名为 "tinypng" 的 API Key
    let existingKey = await db.query.apiKeys.findFirst({
      where: and(
        eq(apiKeys.userId, userId),
        eq(apiKeys.name, TINYPNG_API_KEY_NAME)
      ),
    })

    // 如果不存在，则创建新的
    if (!existingKey) {
      const newKey = `mk_${nanoid(32)}`
      const [created] = await db.insert(apiKeys).values({
        name: TINYPNG_API_KEY_NAME,
        key: newKey,
        userId,
        expiresAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000), // 1 year
        enabled: true,
      }).returning()
      
      existingKey = created
    }

    // 如果 key 被禁用，则重新启用
    if (!existingKey.enabled) {
      await db.update(apiKeys)
        .set({ enabled: true })
        .where(eq(apiKeys.id, existingKey.id))
      existingKey.enabled = true
    }

    return NextResponse.json({
      apiKey: existingKey.key,
      name: existingKey.name,
      created: !existingKey ? true : false,
    })
  } catch (error) {
    console.error("Failed to get/create tinypng API key:", error)
    return NextResponse.json(
      { error: "获取 TinyPNG API Key 失败" },
      { status: 500 }
    )
  }
}
