import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeyPool } from "@/lib/schema"
import { NextResponse } from "next/server"
import { ROLES } from "@/lib/permissions"
import { getUserRole } from "@/lib/auth"
import { desc, asc } from "drizzle-orm"

export const runtime = "edge"

export async function GET(req: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const role = await getUserRole(session.user.id)
  if (role !== ROLES.EMPEROR) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 })
  }

  try {
    const { searchParams } = new URL(req.url)
    const limit = parseInt(searchParams.get("limit") || "100")
    const offset = parseInt(searchParams.get("offset") || "0")

    const db = createDb()
    
    const list = await db.select()
      .from(tinypngKeyPool)
      .orderBy(asc(tinypngKeyPool.status), desc(tinypngKeyPool.createdAt))
      .limit(limit)
      .offset(offset)
      .all()

    return NextResponse.json({ list })
  } catch (error) {
    console.error("Failed to get tinypng pool list:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
