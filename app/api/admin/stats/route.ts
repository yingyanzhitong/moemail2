import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { users, userRoles, roles } from "@/lib/schema"
import { checkPermission } from "@/lib/auth"
import { PERMISSIONS, ROLES } from "@/lib/permissions"
import { sql, eq, and, gte } from "drizzle-orm"

export const runtime = "edge"

export async function GET() {
  try {
    const isEmperor = await checkPermission(PERMISSIONS.PROMOTE_USER)
    if (!isEmperor) {
      return NextResponse.json({ error: "无权限" }, { status: 403 })
    }

    const db = createDb()

    // 1. Total users count
    const totalUsersResult = await db.select({ count: sql<number>`count(*)` }).from(users)
    const totalUsers = Number(totalUsersResult[0].count)

    // 2. New users today
    // We use userRoles.createdAt as a proxy for registration time
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)

    const newUsersResult = await db.select({ count: sql<number>`count(*)` })
      .from(userRoles)
      .leftJoin(roles, eq(userRoles.roleId, roles.id))
      .where(
        and(
            gte(userRoles.createdAt, startOfToday),
            // Optional: Filter only Civilian if we want "new registers" specifically, 
            // but effectively all new users get a role today
        )
      )
    
    // Note: If an admin promotes a user today, their role creation date resets to today.
    // This might inflate "new users today" slightly if promotions happen, but it's acceptable for now.
    const newUsersToday = Number(newUsersResult[0].count)

    return NextResponse.json({
      totalUsers,
      newUsersToday
    })

  } catch (error) {
    console.error("Failed to fetch admin stats:", error)
    return NextResponse.json({ error: "获取统计数据失败" }, { status: 500 })
  }
}
