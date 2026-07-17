import { drizzle } from 'drizzle-orm/d1'
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm'
import { emails, tinypngKeyPool, tinypngTaskRuns, tinypngWorkerNodes } from './schema'
import {
  appendTinyPngTaskRunLog,
  formatTinyPngTaskLog,
} from './tinypng-pool-task-log'
import { calculateTinyPngRegistrationSuccessRate } from './tinypng-pool-success-rate'
import type { TinyPngWorkerDefinition } from './tinypng-pool-workers'
import { detectTinyPngEgressIp, formatTinyPngEgressIpLog } from './tinypng-pool-egress-ip'
import { requestTinyPngRegistration } from './tinypng-registration-proxy'

export const TINYPNG_POOL_LIMIT = 100000
export const TINYPNG_REGISTRATION_BATCH_SIZE = 1

export type TinyPngTaskRunStatus = 'success' | 'partial_failure' | 'skipped' | 'failed'
export type TinyPngTaskTriggerType = 'scheduled' | 'manual'

export interface TinyPngPoolTaskResult {
  taskRunId: string
  workerId: string
  cycleId: string
  status: TinyPngTaskRunStatus
  message: string
  createdCount: number
  cleanedCount: number
  failedCount: number
  successfulCount: number
  poolSize: number
  placement: string | null
  logs: string[]
  startedAt: Date
  completedAt: Date
}

export interface TinyPngPoolTaskOptions {
  worker: TinyPngWorkerDefinition
  cycleId: string
  triggerType: TinyPngTaskTriggerType
  scheduleSlot: Date
  placement?: string | null
  taskRunId?: string
  proxyToken?: string
}

interface ExecuteTaskOptions extends TinyPngPoolTaskOptions {
  batchSize: number
  shouldCleanup: boolean
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

async function getPoolSize(database: D1Database): Promise<number> {
  const db = drizzle(database, { schema: { tinypngKeyPool } })
  const result = await db.select({ value: count() })
    .from(tinypngKeyPool)
    .where(inArray(tinypngKeyPool.status, ['pending', 'registered', 'link_received', 'active', 'reserved', 'assigned']))
    .get()

  return result?.value ?? 0
}

async function ensureWorkerNode(
  database: D1Database,
  worker: TinyPngWorkerDefinition,
): Promise<void> {
  const db = drizzle(database, { schema: { tinypngWorkerNodes } })
  const now = new Date()
  await db.insert(tinypngWorkerNodes)
    .values({
      id: worker.id,
      name: worker.name,
      role: worker.role,
      configuredRegion: worker.configuredRegion,
      maintenanceOwner: worker.maintenanceOwner,
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoUpdate({
      target: tinypngWorkerNodes.id,
      set: {
        name: worker.name,
        role: worker.role,
        configuredRegion: worker.configuredRegion,
        maintenanceOwner: worker.maintenanceOwner,
        updatedAt: now,
      },
    })
}

async function updateWorkerNode(
  database: D1Database,
  workerId: string,
  values: Partial<typeof tinypngWorkerNodes.$inferInsert>,
): Promise<void> {
  const db = drizzle(database, { schema: { tinypngWorkerNodes } })
  await db.update(tinypngWorkerNodes)
    .set({ ...values, updatedAt: new Date() })
    .where(eq(tinypngWorkerNodes.id, workerId))
}

async function getStoredTaskResult(
  database: D1Database,
  taskRunId: string,
  worker: TinyPngWorkerDefinition,
  cycleId: string,
  placement: string | null,
): Promise<TinyPngPoolTaskResult | null> {
  const db = drizzle(database, { schema: { tinypngTaskRuns } })
  const existing = await db.query.tinypngTaskRuns.findFirst({
    where: eq(tinypngTaskRuns.id, taskRunId),
  })
  if (!existing) return null

  const status: TinyPngTaskRunStatus = existing.status === 'running'
    ? 'skipped'
    : existing.status

  return {
    taskRunId,
    workerId: worker.id,
    cycleId,
    status,
    message: existing.status === 'running' ? `${worker.name} 的本轮任务已在执行。` : existing.message.split('\n')[0],
    createdCount: existing.createdCount,
    cleanedCount: existing.cleanedCount,
    failedCount: existing.failedCount,
    successfulCount: existing.successfulCount,
    poolSize: await getPoolSize(database),
    placement: existing.placement ?? placement,
    logs: [existing.message],
    startedAt: existing.startedAt,
    completedAt: existing.completedAt,
  }
}

async function executeTinyPngPoolTask(
  database: D1Database,
  emailDomain: string | undefined,
  options: ExecuteTaskOptions,
): Promise<TinyPngPoolTaskResult> {
  const db = drizzle(database, {
    schema: { emails, tinypngKeyPool, tinypngTaskRuns, tinypngWorkerNodes },
  })
  const startedAt = new Date()
  const placement = options.placement ?? null
  const taskRunId = options.taskRunId ?? crypto.randomUUID()
  let status: TinyPngTaskRunStatus = 'success'
  let message = ''
  let createdCount = 0
  let cleanedCount = 0
  let failedCount = 0
  let successfulCount = 0
  let poolSize = 0
  const logs: string[] = []
  const initialLog = formatTinyPngTaskLog(
    `${options.worker.name} 已启动，职责：${options.shouldCleanup ? '维护清理' : '区域注册'}。`,
    startedAt,
  )
  logs.push(initialLog)

  await ensureWorkerNode(database, options.worker)

  try {
    await db.insert(tinypngTaskRuns).values({
      id: taskRunId,
      workerId: options.worker.id,
      cycleId: options.cycleId,
      triggerType: options.triggerType,
      scheduleSlot: options.scheduleSlot,
      placement,
      status: 'running',
      message: initialLog,
      createdCount,
      cleanedCount,
      failedCount,
      successfulCount,
      startedAt,
      completedAt: startedAt,
    })
  } catch (error) {
    const existing = await getStoredTaskResult(
      database,
      taskRunId,
      options.worker,
      options.cycleId,
      placement,
    )
    if (existing) return existing
    throw error
  }

  await updateWorkerNode(database, options.worker.id, {
    actualPlacement: placement,
    lastStatus: 'running',
    lastRunId: taskRunId,
    lastRunAt: startedAt,
    lastError: null,
  })

  const recordLog = async (nextMessage: string) => {
    const entry = formatTinyPngTaskLog(nextMessage)
    logs.push(entry)
    try {
      await appendTinyPngTaskRunLog(database, taskRunId, entry)
    } catch (error) {
      console.error('Failed to append tinypng pool task log:', error)
    }
  }

  const egressIpProbe = await detectTinyPngEgressIp()
  await recordLog(formatTinyPngEgressIpLog(egressIpProbe))

  try {
    if (options.shouldCleanup) {
      const failedItems = await db.select().from(tinypngKeyPool)
        .where(eq(tinypngKeyPool.status, 'registration_failed'))
        .all()

      for (const item of failedItems) {
        await db.delete(tinypngKeyPool).where(eq(tinypngKeyPool.id, item.id))
        await db.delete(emails).where(eq(emails.address, item.email))
      }
      cleanedCount += failedItems.length
      if (failedItems.length > 0) {
        await recordLog(`清理 ${failedItems.length} 个上次注册失败的记录。`)
      }

      const staleThreshold = new Date(Date.now() - 30 * 60 * 1000)
      const stalePendingItems = await db.select().from(tinypngKeyPool)
        .where(and(
          eq(tinypngKeyPool.status, 'pending'),
          lt(tinypngKeyPool.createdAt, staleThreshold),
        ))
        .all()

      for (const item of stalePendingItems) {
        await db.delete(tinypngKeyPool).where(eq(tinypngKeyPool.id, item.id))
        await db.delete(emails).where(eq(emails.address, item.email))
      }
      cleanedCount += stalePendingItems.length
      if (stalePendingItems.length > 0) {
        await recordLog(`清理 ${stalePendingItems.length} 个超时未完成的注册记录。`)
      }
    }

    poolSize = await getPoolSize(database)
    await recordLog(`当前可用缓冲池数量：${poolSize}/${TINYPNG_POOL_LIMIT}。`)

    if (options.batchSize === 0) {
      message = `维护完成，清理 ${cleanedCount} 个失效记录，当前缓冲池 ${poolSize}/${TINYPNG_POOL_LIMIT}。`
    } else if (poolSize >= TINYPNG_POOL_LIMIT) {
      status = 'skipped'
      message = `缓冲池已满（${poolSize}/${TINYPNG_POOL_LIMIT}），${options.worker.name} 本次未注册。`
      await recordLog(`缓冲池达到上限 ${TINYPNG_POOL_LIMIT}，本次跳过。`)
    } else {
      const domain = emailDomain || 'tinypng-token.site'
      const batchSize = Math.min(options.batchSize, TINYPNG_POOL_LIMIT - poolSize)

      for (let i = 0; i < batchSize; i++) {
        const randomId = crypto.randomUUID().split('-')[0]
        const emailAddress = `tiny_${randomId}@${domain}`
        const poolKeyId = crypto.randomUUID()

        await db.insert(emails).values({
          id: crypto.randomUUID(),
          address: emailAddress,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
          createdAt: new Date(),
        })
        await db.insert(tinypngKeyPool).values({
          id: poolKeyId,
          email: emailAddress,
          taskRunId,
          status: 'pending',
        })
        createdCount++
        await recordLog(`账号 ${i + 1}/${batchSize}：临时邮箱创建成功\n邮箱：${emailAddress}\n步骤 1/6 完成。`)

        try {
          await recordLog(`账号 ${i + 1}/${batchSize}：开始向 TinyPNG 提交注册请求\n步骤 2/6 执行中。`)
          const response = await requestTinyPngRegistration(emailAddress, options.proxyToken)

          if (!response.ok) {
            const text = await response.text()
            failedCount++
            const detail = text || response.statusText || '未返回失败详情'
            await recordLog(
              `账号 ${i + 1}/${batchSize}：TinyPNG 注册失败\n邮箱：${emailAddress}\nHTTP ${response.status} ${response.statusText}\n${detail}`,
            )
            await db.update(tinypngKeyPool)
              .set({
                status: 'registration_failed',
                errorMessage: `${response.status} - ${detail}`,
                updatedAt: new Date(),
              })
              .where(eq(tinypngKeyPool.email, emailAddress))
          } else {
            successfulCount++
            await recordLog(
              `账号 ${i + 1}/${batchSize}：TinyPNG 注册请求已受理\n邮箱：${emailAddress}\nHTTP ${response.status} ${response.statusText}\n步骤 2/6 完成，等待验证邮件继续后续流程。`,
            )
            await db.update(tinypngKeyPool)
              .set({ status: 'registered', updatedAt: new Date() })
              .where(and(
                eq(tinypngKeyPool.email, emailAddress),
                eq(tinypngKeyPool.status, 'pending'),
              ))
          }
        } catch (error) {
          failedCount++
          const detail = getErrorMessage(error)
          await recordLog(`账号 ${i + 1}/${batchSize}：TinyPNG 注册请求异常\n邮箱：${emailAddress}\n${detail}`)
          await db.update(tinypngKeyPool)
            .set({
              status: 'registration_failed',
              errorMessage: detail,
              updatedAt: new Date(),
            })
            .where(eq(tinypngKeyPool.email, emailAddress))
        }
      }

      poolSize += createdCount
      status = failedCount === 0 ? 'success' : successfulCount === 0 ? 'failed' : 'partial_failure'
      const successRate = calculateTinyPngRegistrationSuccessRate(successfulCount, createdCount)
      message = `${options.worker.name} 新增 ${createdCount} 个任务，成功注册 ${successfulCount} 个账号，注册成功率 ${successRate ?? 0}%${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}。`
    }
  } catch (error) {
    status = 'failed'
    message = `任务异常：${getErrorMessage(error).substring(0, 200)}`
    await recordLog(`任务异常：${getErrorMessage(error)}`)
    console.error('Error in tinypng pool worker:', error)
  }

  const completedAt = new Date()

  await db.update(tinypngTaskRuns)
    .set({
      status,
      message: sql`${message} || ${'\n\n'} || ${tinypngTaskRuns.message}`,
      createdCount,
      cleanedCount,
      failedCount,
      successfulCount,
      completedAt,
    })
    .where(eq(tinypngTaskRuns.id, taskRunId))

  await updateWorkerNode(database, options.worker.id, {
    actualPlacement: placement,
    lastStatus: status,
    lastRunId: taskRunId,
    lastRunAt: completedAt,
    lastError: status === 'failed' ? message : null,
  })

  return {
    taskRunId,
    workerId: options.worker.id,
    cycleId: options.cycleId,
    status,
    message,
    createdCount,
    cleanedCount,
    failedCount,
    successfulCount,
    poolSize,
    placement,
    logs,
    startedAt,
    completedAt,
  }
}

export function runTinyPngPoolMaintenanceTask(
  database: D1Database,
  options: TinyPngPoolTaskOptions,
): Promise<TinyPngPoolTaskResult> {
  return executeTinyPngPoolTask(database, undefined, {
    ...options,
    batchSize: 0,
    shouldCleanup: true,
  })
}

export function runTinyPngPoolRegistrationTask(
  database: D1Database,
  emailDomain: string,
  options: TinyPngPoolTaskOptions,
): Promise<TinyPngPoolTaskResult> {
  return executeTinyPngPoolTask(database, emailDomain, {
    ...options,
    batchSize: TINYPNG_REGISTRATION_BATCH_SIZE,
    shouldCleanup: false,
  })
}
