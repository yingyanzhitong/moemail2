import type { Env } from '../types'
import { getTinyPngPoolEmailDomain } from '../app/lib/tinypng-pool-domain'
import { runTinyPngPoolTask } from '../app/lib/tinypng-pool-task'
import { cleanupExpiredDesktopState } from '../app/lib/desktop-license-service'

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    await cleanupExpiredDesktopState(env.DB)
    const emailDomain = await getTinyPngPoolEmailDomain(env.SITE_CONFIG, env.EMAIL_DOMAIN)
    await runTinyPngPoolTask(env.DB, emailDomain)
  }
}
