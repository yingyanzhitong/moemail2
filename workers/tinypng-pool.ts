import type { Env } from '../types'
import { getTinyPngPoolEmailDomain } from '../app/lib/tinypng-pool-domain'
import { runTinyPngPoolTask } from '../app/lib/tinypng-pool-task'

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    const emailDomain = await getTinyPngPoolEmailDomain(env.SITE_CONFIG, env.EMAIL_DOMAIN)
    await runTinyPngPoolTask(env.DB, emailDomain)
  }
}
