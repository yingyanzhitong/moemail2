import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { users, userRoles, roles, emails, tinypngKeys, apiUsageStats } from "@/lib/schema"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS } from "@/lib/permissions"
import { sql, eq } from "drizzle-orm"

export const runtime = "edge"

export async function GET() {
  try {
    const isEmperor = await checkPermission(PERMISSIONS.PROMOTE_USER)
    if (!isEmperor) {
      return NextResponse.json({ error: "无权限" }, { status: 403 })
    }

    const db = createDb()

    // Query 1: Users and Roles
    const usersData = await db.select({
      id: users.id,
      name: users.name,
      username: users.username,
      email: users.email,
      image: users.image,
      role: roles.name,
      joinedAt: userRoles.createdAt,
    })
    .from(users)
    .leftJoin(userRoles, eq(users.id, userRoles.userId))
    .leftJoin(roles, eq(userRoles.roleId, roles.id))

    // Query 2: Email counts
    const emailCounts = await db.select({
      userId: emails.userId,
      count: sql<number>`count(*)`
    })
    .from(emails)
    .groupBy(emails.userId)

    // Query 3: TinyPNG Key counts
    const tinyCounts = await db.select({
      userId: tinypngKeys.userId,
      count: sql<number>`count(*)`
    })
    .from(tinypngKeys)
    .groupBy(tinypngKeys.userId)

    // Query 4: API Usage Stats
    const usageStats = await db.select({
      userId: apiUsageStats.userId,
      endpoint: apiUsageStats.endpoint,
      count: apiUsageStats.count
    })
    .from(apiUsageStats)

    // Merge data
    const emailCountMap = new Map(emailCounts.map(e => [e.userId, e.count]))
    const tinyCountMap = new Map(tinyCounts.map(t => [t.userId, t.count]))
    
    // Group usage by user
    const usageMap = new Map<string, { endpoint: string, count: number }[]>()
    usageStats.forEach(stat => {
        if (!stat.userId) return
        const list = usageMap.get(stat.userId) || []
        list.push({ endpoint: stat.endpoint, count: stat.count })
        usageMap.set(stat.userId, list)
    })

    const result = usersData.map(u => ({
      ...u,
      emailCount: emailCountMap.get(u.id) || 0,
      tinypngCount: tinyCountMap.get(u.id) || 0,
      apiUsage: usageMap.get(u.id) || [],
    }))

    // Sort by joinedAt desc
    result.sort((a, b) => {
        const timeA = a.joinedAt ? new Date(a.joinedAt).getTime() : 0
        const timeB = b.joinedAt ? new Date(b.joinedAt).getTime() : 0
        return timeB - timeA
    })

    return NextResponse.json({ users: result })

  } catch (error) {
    console.error("Failed to fetch admin users:", error)
    return NextResponse.json({ error: "获取用户列表失败" }, { status: 500 })
  }
}
