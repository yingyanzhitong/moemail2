export const TINYPNG_TASK_LOG_WORKER_IDS = [
  'coordinator',
  'registrar-apac',
  'registrar-europe',
  'registrar-americas',
] as const

export type TinyPngTaskLogWorkerId = typeof TINYPNG_TASK_LOG_WORKER_IDS[number]

const WORKER_ID_SET = new Set<string>(TINYPNG_TASK_LOG_WORKER_IDS)
const WORKER_MARKER_PATTERN = /^\[([^\]\r\n]+)\](?:\s+([\s\S]*))?$/

export function groupTinyPngTaskLogs(
  entries: string[],
): Record<TinyPngTaskLogWorkerId, string[]> {
  const grouped = Object.fromEntries(
    TINYPNG_TASK_LOG_WORKER_IDS.map((workerId) => [workerId, [] as string[]]),
  ) as Record<TinyPngTaskLogWorkerId, string[]>
  let currentWorkerId: TinyPngTaskLogWorkerId = 'coordinator'

  for (const entry of entries) {
    const markerMatch = entry.match(WORKER_MARKER_PATTERN)
    const markerWorkerId = markerMatch?.[1]

    if (markerWorkerId && WORKER_ID_SET.has(markerWorkerId)) {
      currentWorkerId = markerWorkerId as TinyPngTaskLogWorkerId
      const markerMessage = markerMatch?.[2]?.trim()
      if (markerMessage) grouped[currentWorkerId].push(markerMessage)
      continue
    }

    if (entry.trim()) grouped[currentWorkerId].push(entry)
  }

  return grouped
}
