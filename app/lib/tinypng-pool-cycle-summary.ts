export type TinyPngCycleRunStatus = 'running' | 'success' | 'partial_failure' | 'skipped' | 'failed'

export interface TinyPngCycleRun {
  id: string
  workerId: string
  cycleId: string | null
  status: TinyPngCycleRunStatus
  message: string
  createdCount: number
  cleanedCount: number
  failedCount: number
  successfulCount: number
  startedAt: Date
  completedAt: Date
}

export interface TinyPngCycleSummary {
  id: string
  cycleId: string | null
  status: TinyPngCycleRunStatus
  message: string
  createdCount: number
  cleanedCount: number
  failedCount: number
  successfulCount: number
  startedAt: Date
  completedAt: Date
  logs: string[]
}

export function summarizeTinyPngCycleRuns(runs: TinyPngCycleRun[]): TinyPngCycleSummary | null {
  if (runs.length === 0) return null

  const registrarRuns = runs.filter((run) => run.workerId !== 'coordinator')
  const statusRuns = registrarRuns.length > 0 ? registrarRuns : runs
  const hasRunning = statusRuns.some((run) => run.status === 'running')
  const hasFailed = statusRuns.some((run) => run.status === 'failed')
  const hasSucceeded = statusRuns.some((run) => ['success', 'partial_failure'].includes(run.status))
  const allSkipped = statusRuns.every((run) => run.status === 'skipped')

  let status: TinyPngCycleRunStatus
  if (hasRunning) {
    status = 'running'
  } else if (hasFailed && !hasSucceeded) {
    status = 'failed'
  } else if (hasFailed || statusRuns.some((run) => run.status === 'partial_failure')) {
    status = 'partial_failure'
  } else if (allSkipped) {
    status = 'skipped'
  } else {
    status = 'success'
  }

  const createdCount = registrarRuns.reduce((sum, run) => sum + run.createdCount, 0)
  const successfulCount = registrarRuns.reduce((sum, run) => sum + run.successfulCount, 0)
  const failedCount = registrarRuns.reduce((sum, run) => sum + run.failedCount, 0)
  const cleanedCount = runs.reduce((sum, run) => sum + run.cleanedCount, 0)
  const startedAt = new Date(Math.min(...runs.map((run) => run.startedAt.getTime())))
  const completedAt = new Date(Math.max(...runs.map((run) => run.completedAt.getTime())))
  const cycleId = runs.find((run) => run.cycleId)?.cycleId ?? null

  return {
    id: cycleId ?? runs[0].id,
    cycleId,
    status,
    message: registrarRuns.length > 0
      ? `本轮调度 ${registrarRuns.length} 个注册节点，成功注册 ${successfulCount} 个账号，失败 ${failedCount} 个，清理 ${cleanedCount} 个失效记录。`
      : runs[0].message.split('\n')[0],
    createdCount,
    cleanedCount,
    failedCount,
    successfulCount,
    startedAt,
    completedAt,
    logs: runs.flatMap((run) => [
      `[${run.workerId}]`,
      run.message,
    ]),
  }
}
