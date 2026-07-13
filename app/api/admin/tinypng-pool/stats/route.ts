import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { desktopLicenses, tinypngKeyPool, tinypngTaskRuns } from "@/lib/schema"
import { getNextTinyPngPoolRunAt, TINYPNG_POOL_SCHEDULE_LABEL } from "@/lib/tinypng-pool-schedule"
import {
  parseEmailDomains,
  resolveTinyPngPoolEmailDomain,
  TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY,
} from "@/lib/tinypng-pool-domain"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { NextResponse } from "next/server"
import { ROLES } from "@/lib/permissions"
import { getUserRole } from "@/lib/auth"
import { and, count, desc, eq, gte, lte } from "drizzle-orm"

export const runtime = "edge"

function splitTaskMessage(message: string) {
  const [summary, ...logLines] = message.split("\n")
  const log = logLines.join("\n").trim()

  return {
    summary,
    logs: log ? [log] : [],
  }
}

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
    const env = getRequestContext().env
    
    const [totalResult, activeResult, pendingResult, usedResult, reservedResult, assignedResult, invalidResult, licenseResult, lastTaskRun, emailDomainsValue, selectedEmailDomain] = await Promise.all([
      db.select({ value: count() }).from(tinypngKeyPool).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'active')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'pending')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'used')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'reserved')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'assigned')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'invalid')).get(),
      db.select({ value: count() }).from(desktopLicenses).where(eq(desktopLicenses.status, 'active')).get(),
      db.query.tinypngTaskRuns.findFirst({ orderBy: desc(tinypngTaskRuns.completedAt) }),
      env.SITE_CONFIG.get("EMAIL_DOMAINS"),
      env.SITE_CONFIG.get(TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY),
    ])
    const parsedLastRun = lastTaskRun ? splitTaskMessage(lastTaskRun.message) : null
    const failedItems = lastTaskRun && parsedLastRun?.logs.length === 0
      ? await db.select({
        email: tinypngKeyPool.email,
        errorMessage: tinypngKeyPool.errorMessage,
        createdAt: tinypngKeyPool.createdAt,
      })
        .from(tinypngKeyPool)
        .where(and(
          eq(tinypngKeyPool.status, "registration_failed"),
          gte(tinypngKeyPool.createdAt, lastTaskRun.startedAt),
          lte(tinypngKeyPool.createdAt, lastTaskRun.completedAt),
        ))
        .orderBy(desc(tinypngKeyPool.createdAt))
      : []
    const lastRunLogs = parsedLastRun?.logs.length
      ? parsedLastRun.logs
      : failedItems.map((item) =>
        `注册失败：${item.email}\n${item.errorMessage || "未记录失败原因"}`,
      )
    const emailDomains = parseEmailDomains(emailDomainsValue)

    return NextResponse.json({
      total: totalResult?.value ?? 0,
      active: activeResult?.value ?? 0,
      pending: pendingResult?.value ?? 0,
      used: usedResult?.value ?? 0,
      reserved: reservedResult?.value ?? 0,
      assigned: assignedResult?.value ?? 0,
      invalid: invalidResult?.value ?? 0,
      desktopLicenses: licenseResult?.value ?? 0,
      emailDomains,
      emailDomain: resolveTinyPngPoolEmailDomain(
        emailDomainsValue,
        selectedEmailDomain,
        env.EMAIL_DOMAIN,
      ) || "",
      taskStatus: {
        scheduleLabel: TINYPNG_POOL_SCHEDULE_LABEL,
        nextRunAt: getNextTinyPngPoolRunAt().toISOString(),
        lastRun: lastTaskRun ? {
          status: lastTaskRun.status,
          message: parsedLastRun?.summary || lastTaskRun.message,
          logs: lastRunLogs,
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
