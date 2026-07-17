import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { desktopLicenses, tinypngKeyPool, tinypngTaskRuns, tinypngWorkerNodes } from "@/lib/schema"
import {
  getNextTinyPngPoolRunAt,
  getTinyPngPoolScheduleLabel,
  parseTinyPngPoolCronExpression,
  TINYPNG_POOL_CRON_CONFIG_KEY,
} from "@/lib/tinypng-pool-schedule"
import { parseEmailDomains } from "@/lib/tinypng-pool-domain"
import { summarizeTinyPngCycleRuns } from "@/lib/tinypng-pool-cycle-summary"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { NextResponse } from "next/server"
import { ROLES } from "@/lib/permissions"
import { getUserRole } from "@/lib/auth"
import { and, asc, count, desc, eq, gte, lte } from "drizzle-orm"
import { calculateTinyPngRegistrationSuccessRate } from "@/lib/tinypng-pool-success-rate"

export const runtime = "edge"

function splitTaskMessage(message: string, status: string) {
  if (status === 'running') {
    return {
      summary: '任务执行中',
      logs: message ? [message] : [],
    }
  }

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

    const [
      totalResult,
      activeResult,
      pendingResult,
      usedResult,
      reservedResult,
      assignedResult,
      invalidResult,
      licenseResult,
      latestTaskRun,
      workerNodes,
      emailDomainsValue,
      cronExpressionValue,
    ] = await Promise.all([
      db.select({ value: count() }).from(tinypngKeyPool).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'active')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'pending')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'used')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'reserved')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'assigned')).get(),
      db.select({ value: count() }).from(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'invalid')).get(),
      db.select({ value: count() }).from(desktopLicenses).where(eq(desktopLicenses.status, 'active')).get(),
      db.query.tinypngTaskRuns.findFirst({ orderBy: desc(tinypngTaskRuns.completedAt) }),
      db.select().from(tinypngWorkerNodes).orderBy(asc(tinypngWorkerNodes.role), asc(tinypngWorkerNodes.name)),
      env.SITE_CONFIG.get("EMAIL_DOMAINS"),
      env.SITE_CONFIG.get(TINYPNG_POOL_CRON_CONFIG_KEY),
    ])

    const cycleRuns = latestTaskRun?.cycleId
      ? await db.select().from(tinypngTaskRuns)
          .where(eq(tinypngTaskRuns.cycleId, latestTaskRun.cycleId))
          .orderBy(asc(tinypngTaskRuns.startedAt))
      : latestTaskRun
        ? [latestTaskRun]
        : []
    const cycleSummary = summarizeTinyPngCycleRuns(cycleRuns)
    const legacyParsedRun = latestTaskRun && !latestTaskRun.cycleId
      ? splitTaskMessage(latestTaskRun.message, latestTaskRun.status)
      : null
    const failedItems = latestTaskRun && !latestTaskRun.cycleId && legacyParsedRun?.logs.length === 0
      ? await db.select({
          email: tinypngKeyPool.email,
          errorMessage: tinypngKeyPool.errorMessage,
          createdAt: tinypngKeyPool.createdAt,
        })
          .from(tinypngKeyPool)
          .where(and(
            eq(tinypngKeyPool.status, "registration_failed"),
            gte(tinypngKeyPool.createdAt, latestTaskRun.startedAt),
            lte(tinypngKeyPool.createdAt, latestTaskRun.completedAt),
          ))
          .orderBy(desc(tinypngKeyPool.createdAt))
      : []
    const lastRunLogs = cycleSummary?.logs.length
      ? cycleSummary.logs
      : legacyParsedRun?.logs.length
        ? legacyParsedRun.logs
        : failedItems.map((item) =>
            `注册失败：${item.email}\n${item.errorMessage || "未记录失败原因"}`,
          )
    const workerRuns = await Promise.all(workerNodes.map(async (worker) => ({
      worker,
      lastRun: await db.query.tinypngTaskRuns.findFirst({
        where: eq(tinypngTaskRuns.workerId, worker.id),
        orderBy: desc(tinypngTaskRuns.completedAt),
      }),
    })))
    const cronExpression = parseTinyPngPoolCronExpression(cronExpressionValue)
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
      cronExpression,
      workers: workerRuns.map(({ worker, lastRun }) => ({
        id: worker.id,
        name: worker.name,
        role: worker.role,
        configuredRegion: worker.configuredRegion,
        actualPlacement: worker.actualPlacement,
        emailDomain: worker.emailDomain,
        enabled: worker.enabled,
        maintenanceOwner: worker.maintenanceOwner,
        status: worker.lastStatus,
        lastRunAt: worker.lastRunAt,
        lastError: worker.lastError,
        lastRun: lastRun ? {
          id: lastRun.id,
          status: lastRun.status,
          createdCount: lastRun.createdCount,
          cleanedCount: lastRun.cleanedCount,
          failedCount: lastRun.failedCount,
          successfulCount: lastRun.successfulCount,
          successRate: calculateTinyPngRegistrationSuccessRate(
            lastRun.successfulCount,
            lastRun.createdCount,
          ),
          completedAt: lastRun.completedAt,
        } : null,
      })),
      taskStatus: {
        scheduleLabel: getTinyPngPoolScheduleLabel(cronExpression),
        nextRunAt: getNextTinyPngPoolRunAt(new Date(), cronExpression).toISOString(),
        lastRun: cycleSummary ? {
          id: cycleSummary.id,
          status: cycleSummary.status,
          message: cycleSummary.message,
          logs: lastRunLogs,
          createdCount: cycleSummary.createdCount,
          cleanedCount: cycleSummary.cleanedCount,
          failedCount: cycleSummary.failedCount,
          successfulCount: cycleSummary.successfulCount,
          successRate: calculateTinyPngRegistrationSuccessRate(
            cycleSummary.successfulCount,
            cycleSummary.createdCount,
          ),
          durationMs: Math.max(cycleSummary.completedAt.getTime() - cycleSummary.startedAt.getTime(), 0),
          completedAt: cycleSummary.completedAt,
        } : null,
      },
    })
  } catch (error) {
    console.error("Failed to get tinypng pool stats:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
