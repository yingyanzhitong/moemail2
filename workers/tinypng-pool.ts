import type { Env } from '../types'
import { runTinyPngPoolTask } from '../app/lib/tinypng-pool-task'

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    await runTinyPngPoolTask(env.DB, env.EMAIL_DOMAIN)
  }
}
