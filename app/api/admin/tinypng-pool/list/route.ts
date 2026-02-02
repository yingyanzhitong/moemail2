import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeyPool } from "@/lib/schema"
import { NextResponse } from "next/server"
import { ROLES } from "@/lib/permissions"
import { getUserRole } from "@/lib/auth"
import { desc } from "drizzle-orm"

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
    
    // Get list, limited to latest 100 for now or add pagination if needed
    // User requested "details page", usually a list.
    const list = await db.select()
      .from(tinypngKeyPool)
      .orderBy(desc(tinypngKeyPool.createdAt))
      .limit(100)
      .all()

    return NextResponse.json({ list })
  } catch (error) {
    console.error("Failed to get tinypng pool list:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
