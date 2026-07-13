import { drizzle } from 'drizzle-orm/d1'
import { and, count, eq, inArray, lt } from 'drizzle-orm'
import { emails, tinypngKeyPool, tinypngTaskRuns } from './schema'

const POOL_LIMIT = 100000
const BATCH_SIZE = 5

type TaskRunStatus = 'success' | 'partial_failure' | 'skipped' | 'failed'

export interface TinyPngPoolTaskResult {
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
      logs.push(`清理 ${failedItems.length} 个上次注册失败的记录。`)
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
      logs.push(`清理 ${stalePendingItems.length} 个超时未完成的注册记录。`)
    }

    const poolCountResult = await db.select({ value: count() })
      .from(tinypngKeyPool)
      .where(inArray(tinypngKeyPool.status, ['pending', 'registered', 'link_received', 'active', 'reserved', 'assigned']))
      .get()

    const currentSize = poolCountResult?.value ?? 0
    if (currentSize >= POOL_LIMIT) {
      status = 'skipped'
      message = `缓冲池已满（${currentSize}/${POOL_LIMIT}），本次未生成。`
      logs.push(`当前可用缓冲池数量：${currentSize}，达到上限 ${POOL_LIMIT}。`)
    } else {
      const domain = emailDomain || 'tinypng-token.site'

      for (let i = 0; i < BATCH_SIZE; i++) {
        const randomId = crypto.randomUUID().split('-')[0]
        const emailAddress = `tiny_${randomId}@${domain}`

        await db.insert(emails).values({
          id: crypto.randomUUID(),
          address: emailAddress,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365),
          createdAt: new Date(),
        })
        await db.insert(tinypngKeyPool).values({
          email: emailAddress,
          status: 'pending'
        })
        createdCount++

        try {
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
            logs.push(
              `注册失败：${emailAddress}\nHTTP ${response.status} ${response.statusText}\n${detail}`,
            )
            await db.update(tinypngKeyPool)
              .set({
                status: 'registration_failed',
                errorMessage: `${response.status} - ${detail}`,
                updatedAt: new Date()
              })
              .where(eq(tinypngKeyPool.email, emailAddress))
            continue
          }

          successfulCount++
          logs.push(`注册成功：${emailAddress}\nHTTP ${response.status} ${response.statusText}`)
          await db.update(tinypngKeyPool)
            .set({ status: 'registered', updatedAt: new Date() })
            .where(eq(tinypngKeyPool.email, emailAddress))
        } catch (error) {
          failedCount++
          const detail = getErrorMessage(error)
          logs.push(`注册异常：${emailAddress}\n${detail}`)
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
      message = `新增 ${createdCount} 个任务，成功注册 ${successfulCount} 个账号，清理 ${cleanedCount} 个失效记录${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}。`
    }
  } catch (error) {
    status = 'failed'
    message = `任务异常：${getErrorMessage(error).substring(0, 200)}`
    logs.push(`任务异常：${getErrorMessage(error)}`)
    console.error('Error in tinypng pool worker:', error)
  }

  const completedAt = new Date()
  const result = {
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
    await db.insert(tinypngTaskRuns).values({
      status,
      message: [message, ...logs].filter(Boolean).join('\n\n'),
      createdCount,
      cleanedCount,
      failedCount,
      successfulCount,
      startedAt,
      completedAt,
    })
  } catch (error) {
    console.error('Failed to save tinypng task run:', error)
  }

  return result
}
