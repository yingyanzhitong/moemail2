export const TINYPNG_POOL_CRON_CONFIG_KEY = 'TINYPNG_POOL_CRON_EXPRESSION'
export const DEFAULT_TINYPNG_POOL_CRON_EXPRESSION = '0 * * * *'

const SHANGHAI_UTC_OFFSET_MS = 8 * 60 * 60 * 1000
const MAX_NEXT_RUN_SEARCH_DAYS = 366 * 5

interface ParsedCronField {
  values: Set<number>
  wildcard: boolean
}

interface ParsedCronExpression {
  minute: ParsedCronField
  hour: ParsedCronField
  dayOfMonth: ParsedCronField
  month: ParsedCronField
  dayOfWeek: ParsedCronField
}

function parseInteger(value: string, min: number, max: number): number {
  if (!/^\d+$/.test(value)) throw new Error('Cron 字段必须是整数')

  const parsed = Number(value)
  if (parsed < min || parsed > max) throw new Error('Cron 字段超出允许范围')
  return parsed
}

function parseCronField(
  source: string,
  min: number,
  max: number,
  normalize: (value: number) => number = (value) => value,
): ParsedCronField {
  if (!source) throw new Error('Cron 字段不能为空')

  const values = new Set<number>()
  const segments = source.split(',')

  for (const segment of segments) {
    const stepParts = segment.split('/')
    if (stepParts.length > 2) throw new Error('Cron 步长格式无效')

    const rangeSource = stepParts[0]
    const step = stepParts[1] === undefined
      ? 1
      : parseInteger(stepParts[1], 1, max - min + 1)
    let start: number
    let end: number

    if (rangeSource === '*') {
      start = min
      end = max
    } else if (rangeSource.includes('-')) {
      const rangeParts = rangeSource.split('-')
      if (rangeParts.length !== 2) throw new Error('Cron 范围格式无效')
      start = parseInteger(rangeParts[0], min, max)
      end = parseInteger(rangeParts[1], min, max)
      if (start > end) throw new Error('Cron 范围起始值不能大于结束值')
    } else {
      start = parseInteger(rangeSource, min, max)
      end = stepParts[1] === undefined ? start : max
    }

    for (let value = start; value <= end; value += step) {
      values.add(normalize(value))
    }
  }

  if (values.size === 0) throw new Error('Cron 字段没有可用值')
  return { values, wildcard: source === '*' }
}

function parseCronExpression(expression: string): ParsedCronExpression {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error('Cron 表达式必须包含 5 个字段')

  return {
    minute: parseCronField(fields[0], 0, 59),
    hour: parseCronField(fields[1], 0, 23),
    dayOfMonth: parseCronField(fields[2], 1, 31),
    month: parseCronField(fields[3], 1, 12),
    dayOfWeek: parseCronField(fields[4], 0, 7, (value) => value === 7 ? 0 : value),
  }
}

function matchesCronDay(
  localDate: Date,
  parsed: ParsedCronExpression,
): boolean {
  const dayOfMonthMatches = parsed.dayOfMonth.values.has(localDate.getUTCDate())
  const dayOfWeekMatches = parsed.dayOfWeek.values.has(localDate.getUTCDay())

  if (parsed.dayOfMonth.wildcard) return dayOfWeekMatches
  if (parsed.dayOfWeek.wildcard) return dayOfMonthMatches
  return dayOfMonthMatches || dayOfWeekMatches
}

function getShanghaiDate(value: Date): Date {
  return new Date(value.getTime() + SHANGHAI_UTC_OFFSET_MS)
}

export function normalizeTinyPngPoolCronExpression(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const normalized = value.trim().split(/\s+/).join(' ')
  try {
    parseCronExpression(normalized)
    return normalized
  } catch {
    return null
  }
}

export function isValidTinyPngPoolCronExpression(value: unknown): value is string {
  return normalizeTinyPngPoolCronExpression(value) !== null
}

export function parseTinyPngPoolCronExpression(
  value: string | null | undefined,
): string {
  return normalizeTinyPngPoolCronExpression(value)
    ?? DEFAULT_TINYPNG_POOL_CRON_EXPRESSION
}

export async function getTinyPngPoolCronExpression(
  siteConfig: Pick<KVNamespace, 'get'>,
): Promise<string> {
  return parseTinyPngPoolCronExpression(
    await siteConfig.get(TINYPNG_POOL_CRON_CONFIG_KEY),
  )
}

export function getTinyPngPoolScheduleLabel(cronExpression: string): string {
  return `${cronExpression}（Linux Cron，北京时间）`
}

export function shouldRunTinyPngPoolScheduledTask(
  scheduledAt: Date,
  cronExpression: string,
): boolean {
  const parsed = parseCronExpression(parseTinyPngPoolCronExpression(cronExpression))
  const localDate = getShanghaiDate(scheduledAt)

  return parsed.minute.values.has(localDate.getUTCMinutes())
    && parsed.hour.values.has(localDate.getUTCHours())
    && parsed.month.values.has(localDate.getUTCMonth() + 1)
    && matchesCronDay(localDate, parsed)
}

export function getNextTinyPngPoolRunAt(
  from = new Date(),
  cronExpression = DEFAULT_TINYPNG_POOL_CRON_EXPRESSION,
): Date {
  const parsed = parseCronExpression(parseTinyPngPoolCronExpression(cronExpression))
  const searchFrom = new Date(from)
  searchFrom.setUTCSeconds(0, 0)
  searchFrom.setUTCMinutes(searchFrom.getUTCMinutes() + 1)

  const localDay = getShanghaiDate(searchFrom)
  localDay.setUTCHours(0, 0, 0, 0)
  const hours = [...parsed.hour.values].sort((left, right) => left - right)
  const minutes = [...parsed.minute.values].sort((left, right) => left - right)

  for (let dayIndex = 0; dayIndex <= MAX_NEXT_RUN_SEARCH_DAYS; dayIndex++) {
    if (
      parsed.month.values.has(localDay.getUTCMonth() + 1)
      && matchesCronDay(localDay, parsed)
    ) {
      for (const hour of hours) {
        for (const minute of minutes) {
          const candidateTime = Date.UTC(
            localDay.getUTCFullYear(),
            localDay.getUTCMonth(),
            localDay.getUTCDate(),
            hour,
            minute,
          ) - SHANGHAI_UTC_OFFSET_MS

          if (candidateTime >= searchFrom.getTime()) {
            return new Date(candidateTime)
          }
        }
      }
    }

    localDay.setUTCDate(localDay.getUTCDate() + 1)
  }

  throw new Error('未来 5 年内没有匹配该 Cron 表达式的执行时间')
}
