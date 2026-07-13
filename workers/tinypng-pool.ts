import type { Env } from '../types'
import { getTinyPngPoolEmailDomain } from '../app/lib/tinypng-pool-domain'
import { runTinyPngPoolTask } from '../app/lib/tinypng-pool-task'
import { cleanupExpiredDesktopState } from '../app/lib/desktop-license-service'
import {
  getTinyPngPoolCronExpression,
  shouldRunTinyPngPoolScheduledTask,
} from '../app/lib/tinypng-pool-schedule'

export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    const scheduledAt = new Date(event.scheduledTime)
    if (scheduledAt.getUTCMinutes() === 0) {
      await cleanupExpiredDesktopState(env.DB)
    }

    const cronExpression = await getTinyPngPoolCronExpression(env.SITE_CONFIG)

    if (!shouldRunTinyPngPoolScheduledTask(scheduledAt, cronExpression)) {
      console.log(`Skip TinyPNG Pool task at ${scheduledAt.toISOString()}; cron is ${cronExpression}.`)
      return
    }

    const emailDomain = await getTinyPngPoolEmailDomain(env.SITE_CONFIG, env.EMAIL_DOMAIN)
    await runTinyPngPoolTask(env.DB, emailDomain)
  }
}
