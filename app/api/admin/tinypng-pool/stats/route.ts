import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeyPool, tinypngTaskRuns } from "@/lib/schema"
import { getNextTinyPngPoolRunAt, TINYPNG_POOL_SCHEDULE_LABEL } from "@/lib/tinypng-pool-schedule"
import { NextResponse } from "next/server"
import { ROLES } from "@/lib/permissions"
import { getUserRole } from "@/lib/auth"
import { count, desc, eq } from "drizzle-orm"

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
    
    const [totalResult, activeResult, pendingResult, usedResult, lastTaskRun] = await Promise.all([
      db.select({ value: count() }).from(tinypngKeyPool).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'active')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'pending')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'used')).get(),
      db.query.tinypngTaskRuns.findFirst({ orderBy: desc(tinypngTaskRuns.completedAt) }),
    ])

    return NextResponse.json({
      total: totalResult?.value ?? 0,
      active: activeResult?.value ?? 0,
      pending: pendingResult?.value ?? 0,
      used: usedResult?.value ?? 0,
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
    console.error("Failed to get tinypng pool stats:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
