import { drizzle } from 'drizzle-orm/d1'
import { and, count, eq, inArray, lt, sql } from 'drizzle-orm'
import { emails, tinypngKeyPool, tinypngTaskRuns } from './schema'
import {
  appendTinyPngTaskRunLog,
  formatTinyPngTaskLog,
} from './tinypng-pool-task-log'
import { calculateTinyPngRegistrationSuccessRate } from './tinypng-pool-success-rate'

const POOL_LIMIT = 100000
const BATCH_SIZE = 5

type TaskRunStatus = 'success' | 'partial_failure' | 'skipped' | 'failed'

export interface TinyPngPoolTaskResult {
  taskRunId: string
  status: TaskRunStatus
  message: string
  createdCount: number
  cleanedCount: number
  failedCount: number
  successfulCount: number
  logs: string[]
  startedAt: Date
  completedAt: Date
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export async function runTinyPngPoolTask(
  database: D1Database,
  emailDomain?: string,
): Promise<TinyPngPoolTaskResult> {
  const db = drizzle(database, { schema: { emails, tinypngKeyPool, tinypngTaskRuns } })
  const startedAt = new Date()
  let status: TaskRunStatus = 'success'
  let message = ''
  let createdCount = 0
  let cleanedCount = 0
  let failedCount = 0
  let successfulCount = 0
  const logs: string[] = []
  const taskRunId = crypto.randomUUID()
  const initialLog = formatTinyPngTaskLog('任务已启动，准备检查缓冲池状态。', startedAt)
  let taskRunPersisted = false
  logs.push(initialLog)

  try {
    await db.insert(tinypngTaskRuns).values({
      id: taskRunId,
      status: 'running',
      message: initialLog,
      createdCount,
      cleanedCount,
      failedCount,
      successfulCount,
      startedAt,
      completedAt: startedAt,
    })
    taskRunPersisted = true
  } catch (error) {
    console.error('Failed to start tinypng pool task run:', error)
  }

  const recordLog = async (message: string) => {
    const entry = formatTinyPngTaskLog(message)
    logs.push(entry)

    if (!taskRunPersisted) return

    try {
      await appendTinyPngTaskRunLog(database, taskRunId, entry)
    } catch (error) {
      console.error('Failed to append tinypng pool task log:', error)
    }
  }

  try {
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
        lt(tinypngKeyPool.createdAt, staleThreshold)
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

    const poolCountResult = await db.select({ value: count() })
      .from(tinypngKeyPool)
      .where(inArray(tinypngKeyPool.status, ['pending', 'registered', 'link_received', 'active', 'reserved', 'assigned']))
      .get()

    const currentSize = poolCountResult?.value ?? 0
    await recordLog(`当前可用缓冲池数量：${currentSize}/${POOL_LIMIT}。`)
    if (currentSize >= POOL_LIMIT) {
      status = 'skipped'
      message = `缓冲池已满（${currentSize}/${POOL_LIMIT}），本次未生成。`
      await recordLog(`缓冲池达到上限 ${POOL_LIMIT}，本次跳过。`)
    } else {
      const domain = emailDomain || 'tinypng-token.site'

      for (let i = 0; i < BATCH_SIZE; i++) {
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
          status: 'pending'
        })
        createdCount++
        await recordLog(`账号 ${i + 1}/${BATCH_SIZE}：临时邮箱创建成功\n邮箱：${emailAddress}\n步骤 1/6 完成。`)

        try {
          await recordLog(`账号 ${i + 1}/${BATCH_SIZE}：开始向 TinyPNG 提交注册请求\n步骤 2/6 执行中。`)
          const response = await fetch('https://tinify.com/web/api', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'Accept': 'application/json, text/plain, */*',
              'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
              'Origin': 'https://tinify.com',
              'Referer': 'https://tinify.com/developers',
            },
            body: JSON.stringify({ fullName: emailAddress, mail: emailAddress })
          })

          if (!response.ok) {
            const text = await response.text()
            failedCount++
            const detail = text || response.statusText || "未返回失败详情"
            await recordLog(
              `账号 ${i + 1}/${BATCH_SIZE}：TinyPNG 注册失败\n邮箱：${emailAddress}\nHTTP ${response.status} ${response.statusText}\n${detail}`,
            )
            await db.update(tinypngKeyPool)
              .set({
                status: 'registration_failed',
                errorMessage: `${response.status} - ${detail}`,
                updatedAt: new Date()
              })
              .where(eq(tinypngKeyPool.email, emailAddress))
          } else {
            successfulCount++
            await recordLog(
              `账号 ${i + 1}/${BATCH_SIZE}：TinyPNG 注册请求已受理\n邮箱：${emailAddress}\nHTTP ${response.status} ${response.statusText}\n步骤 2/6 完成，等待验证邮件继续后续流程。`,
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
          await recordLog(`账号 ${i + 1}/${BATCH_SIZE}：TinyPNG 注册请求异常\n邮箱：${emailAddress}\n${detail}`)
          await db.update(tinypngKeyPool)
            .set({
              status: 'registration_failed',
              errorMessage: detail,
              updatedAt: new Date()
            })
            .where(eq(tinypngKeyPool.email, emailAddress))
        }

      }

      status = failedCount === 0 ? 'success' : successfulCount === 0 ? 'failed' : 'partial_failure'
      const successRate = calculateTinyPngRegistrationSuccessRate(successfulCount, createdCount)
      message = `新增 ${createdCount} 个任务，成功注册 ${successfulCount} 个账号，注册成功率 ${successRate ?? 0}%，清理 ${cleanedCount} 个失效记录${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}。`
    }
  } catch (error) {
    status = 'failed'
    message = `任务异常：${getErrorMessage(error).substring(0, 200)}`
    await recordLog(`任务异常：${getErrorMessage(error)}`)
    console.error('Error in tinypng pool worker:', error)
  }

  const completedAt = new Date()
  const result = {
    taskRunId,
    status,
    message,
    createdCount,
    cleanedCount,
    failedCount,
    successfulCount,
    logs,
    startedAt,
    completedAt,
  }

  try {
    if (taskRunPersisted) {
      await db.update(tinypngTaskRuns)
        .set({
          status,
          message: sql`${message} || ${"\n\n"} || ${tinypngTaskRuns.message}`,
          createdCount,
          cleanedCount,
          failedCount,
          successfulCount,
          completedAt,
        })
        .where(eq(tinypngTaskRuns.id, taskRunId))
    } else {
      await db.insert(tinypngTaskRuns).values({
        id: taskRunId,
        status,
        message: [message, ...logs].filter(Boolean).join('\n\n'),
        createdCount,
        cleanedCount,
        failedCount,
        successfulCount,
        startedAt,
        completedAt,
      })
    }
  } catch (error) {
    console.error('Failed to save tinypng task run:', error)
  }

  return result
}
