import { createDb } from "./db"
import { apiKeys, apiUsageStats } from "./schema"
import { eq, and, gt, sql } from "drizzle-orm"
import { NextResponse } from "next/server"
import type { User } from "next-auth"
import { auth } from "./auth"
import { headers } from "next/headers"

async function getUserByApiKey(key: string): Promise<User | null> {
  const db = createDb()
  const apiKey = await db.query.apiKeys.findFirst({
    where: and(
      eq(apiKeys.key, key),
      eq(apiKeys.enabled, true),
      gt(apiKeys.expiresAt, new Date())
    ),
    with: {
      user: true
    }
  })

  if (!apiKey) return null

  return apiKey.user
}

export async function handleApiKeyAuth(apiKey: string, pathname: string) {
  // 允许 API Key 访问的路径
  const allowedPaths = ['/api/emails', '/api/config', '/api/tinypng', '/api/api-keys/tinypng']
  const isAllowed = allowedPaths.some(path => pathname.startsWith(path))
  
  if (!isAllowed) {
    return NextResponse.json(
      { error: "无权限查看" },
      { status: 403 }
    )
  }

  const user = await getUserByApiKey(apiKey)
  if (!user?.id) {
    return NextResponse.json(
      { error: "无效的 API Key" },
      { status: 401 }
    )
  }

  const requestHeaders = new Headers(await headers())
  requestHeaders.set("X-User-Id", user.id)
  
  const response = NextResponse.next({
    request: {
      headers: requestHeaders
    }
  })
  // API Usage Tracking
  try {
    const db = createDb()
    // Group endpoints to avoid cardinality explosion
    let endpoint = allowedPaths.find(p => pathname.startsWith(p)) || pathname

    await db.insert(apiUsageStats)
      .values({
        userId: user.id,
        endpoint: endpoint,
        count: 1,
      })
      .onConflictDoUpdate({
        target: [apiUsageStats.userId, apiUsageStats.endpoint],
        set: {
          count: sql`${apiUsageStats.count} + 1`,
          lastUsedAt: new Date(),
        }
      })
  } catch (error) {
    console.error('Failed to log API usage:', error)
  }

  return response
}

export const getUserId = async () => {
  const headersList = await headers()
  const userId = headersList.get("X-User-Id")
  
  if (userId) return userId

  const session = await auth()

  return session?.user.id
}
