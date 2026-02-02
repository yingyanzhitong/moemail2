import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeyPool } from "@/lib/schema"
import { NextResponse } from "next/server"
import { ROLES } from "@/lib/permissions"
import { getUserRole } from "@/lib/auth"
import { count, eq } from "drizzle-orm"

export const runtime = "edge"

export async function GET() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const role = await getUserRole(session.user.id)
  if (role !== ROLES.EMPEROR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const db = createDb()
    
    // Get counts
    const totalResult = await db.select({ value: count() }).from(tinypngKeyPool).get()
    const activeResult = await db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'active')).get()
    const pendingResult = await db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'pending')).get()
    const usedResult = await db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'used')).get()

    return NextResponse.json({
      total: totalResult?.value ?? 0,
      active: activeResult?.value ?? 0,
      pending: pendingResult?.value ?? 0,
      used: usedResult?.value ?? 0,
    })
  } catch (error) {
    console.error("Failed to get tinypng pool stats:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
