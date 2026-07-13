export const TINYPNG_POOL_SCHEDULE_LABEL = '每小时整点'

export function getNextTinyPngPoolRunAt(from = new Date()): Date {
  const nextRunAt = new Date(from)
  nextRunAt.setUTCMinutes(0, 0, 0)
  nextRunAt.setUTCHours(nextRunAt.getUTCHours() + 1)
  return nextRunAt
}
