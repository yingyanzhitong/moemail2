import type { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { emails, tinypngKeyPool, tinypngTaskRuns } from '../app/lib/schema'
import { count, eq, inArray, and, lt } from 'drizzle-orm'

const POOL_LIMIT = 100000
const BATCH_SIZE = 5

type TaskRunStatus = 'success' | 'partial_failure' | 'skipped' | 'failed'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    const db = drizzle(env.DB, { schema: { emails, tinypngKeyPool, tinypngTaskRuns } })
    const startedAt = new Date()
    let status: TaskRunStatus = 'success'
    let message = ''
    let createdCount = 0
    let cleanedCount = 0
    let failedCount = 0
    let successfulCount = 0

    try {
      const failedItems = await db.select().from(tinypngKeyPool)
        .where(eq(tinypngKeyPool.status, 'registration_failed'))
        .all()

      for (const item of failedItems) {
        await db.delete(tinypngKeyPool).where(eq(tinypngKeyPool.id, item.id))
        await db.delete(emails).where(eq(emails.address, item.email))
      }
      cleanedCount += failedItems.length

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

      const poolCountResult = await db.select({ value: count() })
        .from(tinypngKeyPool)
        .where(inArray(tinypngKeyPool.status, ['pending', 'registered', 'link_received', 'active']))
        .get()

      const currentSize = poolCountResult?.value ?? 0
      if (currentSize >= POOL_LIMIT) {
        status = 'skipped'
        message = `缓冲池已满（${currentSize}/${POOL_LIMIT}），本次未生成。`
        return
      }

      const domain = env.EMAIL_DOMAIN || 'tinypng-token.site'
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
            await db.update(tinypngKeyPool)
              .set({
                status: 'registration_failed',
                errorMessage: `${response.status} - ${text.substring(0, 200)}`,
                updatedAt: new Date()
              })
              .where(eq(tinypngKeyPool.email, emailAddress))
            continue
          }

          successfulCount++
          await db.update(tinypngKeyPool)
            .set({ status: 'registered', updatedAt: new Date() })
            .where(eq(tinypngKeyPool.email, emailAddress))
        } catch (error) {
          failedCount++
          await db.update(tinypngKeyPool)
            .set({
              status: 'registration_failed',
              errorMessage: getErrorMessage(error).substring(0, 200),
              updatedAt: new Date()
            })
            .where(eq(tinypngKeyPool.email, emailAddress))
        }
      }

      status = failedCount === 0 ? 'success' : successfulCount === 0 ? 'failed' : 'partial_failure'
      message = `新增 ${createdCount} 个任务，成功注册 ${successfulCount} 个账号，清理 ${cleanedCount} 个失效记录${failedCount > 0 ? `，失败 ${failedCount} 个` : ''}。`
    } catch (error) {
      status = 'failed'
      message = `任务异常：${getErrorMessage(error).substring(0, 200)}`
      console.error('Error in tinypng pool worker:', error)
    } finally {
      try {
        await db.insert(tinypngTaskRuns).values({
          status,
          message,
          createdCount,
          cleanedCount,
          failedCount,
          successfulCount,
          startedAt,
          completedAt: new Date(),
        })
      } catch (error) {
        console.error('Failed to save tinypng task run:', error)
      }
    }
  }
}
