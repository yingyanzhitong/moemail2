import { drizzle } from 'drizzle-orm/d1'
import { and, eq } from 'drizzle-orm'
import { tinypngTaskRuns, tinypngWorkerNodes } from './schema'
import {
  runTinyPngPoolMaintenanceTask,
  TINYPNG_POOL_LIMIT,
  type TinyPngPoolTaskResult,
  type TinyPngTaskRunStatus,
  type TinyPngTaskTriggerType,
} from './tinypng-pool-task'
import {
  TINYPNG_COORDINATOR_WORKER,
  TINYPNG_REGISTRAR_WORKERS,
  type TinyPngRegistrarBindingEnv,
  type TinyPngWorkerDefinition,
} from './tinypng-pool-workers'

export interface TinyPngPoolCoordinatorEnv extends TinyPngRegistrarBindingEnv {
  DB: D1Database
}

export interface TinyPngPoolCoordinatorOptions {
  triggerType: TinyPngTaskTriggerType
  scheduledAt: Date
  emailDomain: string
}

export interface TinyPngPoolCoordinatorResult {
  taskRunId: string
  cycleId: string
  status: TinyPngTaskRunStatus
  message: string
  createdCount: number
  cleanedCount: number
  failedCount: number
  successfulCount: number
  logs: string[]
  maintenance: TinyPngPoolTaskResult
  workers: TinyPngPoolTaskResult[]
}

interface RegistrarRequestPayload {
  cycleId: string
  triggerType: TinyPngTaskTriggerType
  scheduleSlot: string
  emailDomain: string
}

function getCycleId(triggerType: TinyPngTaskTriggerType, scheduledAt: Date): string {
  return triggerType === 'scheduled'
    ? `scheduled:${scheduledAt.toISOString()}`
    : `manual:${crypto.randomUUID()}`
}

function createFailedWorkerResult(
  worker: TinyPngWorkerDefinition,
  cycleId: string,
  scheduledAt: Date,
  message: string,
): TinyPngPoolTaskResult {
  return {
    taskRunId: `${cycleId}:${worker.id}`,
    workerId: worker.id,
    cycleId,
    status: 'failed',
    message,
    createdCount: 0,
    cleanedCount: 0,
    failedCount: 1,
    successfulCount: 0,
    poolSize: 0,
    placement: null,
    logs: [message],
    startedAt: scheduledAt,
    completedAt: new Date(),
  }
}

export function summarizeTinyPngPoolCycle(
  cycleId: string,
  maintenance: TinyPngPoolTaskResult,
  workers: TinyPngPoolTaskResult[],
): TinyPngPoolCoordinatorResult {
  const createdCount = workers.reduce((sum, result) => sum + result.createdCount, 0)
  const successfulCount = workers.reduce((sum, result) => sum + result.successfulCount, 0)
  const failedCount = workers.reduce((sum, result) => sum + result.failedCount, 0)
  const hasFailure = maintenance.status === 'failed' || workers.some((result) => result.status === 'failed')
  const hasSuccess = workers.some((result) => result.status === 'success' || result.status === 'partial_failure')
  const allSkipped = workers.length === 0 || workers.every((result) => result.status === 'skipped')

  let status: TinyPngTaskRunStatus
  if (maintenance.status === 'failed' || (hasFailure && !hasSuccess)) {
    status = 'failed'
  } else if (hasFailure || workers.some((result) => result.status === 'partial_failure')) {
    status = 'partial_failure'
  } else if (allSkipped) {
    status = 'skipped'
  } else {
    status = 'success'
  }

  const message = workers.length === 0
    ? `维护完成，本轮没有可执行的注册节点；清理 ${maintenance.cleanedCount} 个失效记录。`
    : `本轮调度 ${workers.length} 个注册节点，成功注册 ${successfulCount} 个账号，失败 ${failedCount} 个，清理 ${maintenance.cleanedCount} 个失效记录。`

  return {
    taskRunId: cycleId,
    cycleId,
    status,
    message,
    createdCount,
    cleanedCount: maintenance.cleanedCount,
    failedCount,
    successfulCount,
    logs: [
      `[${maintenance.workerId}] ${maintenance.message}`,
      ...workers.flatMap((result) => [
        `[${result.workerId}] ${result.message}`,
        ...result.logs,
      ]),
    ],
    maintenance,
    workers,
  }
}

async function markWorkerDispatchFailed(
  database: D1Database,
  worker: TinyPngWorkerDefinition,
  taskRunId: string,
  cycleId: string,
  triggerType: TinyPngTaskTriggerType,
  scheduleSlot: Date,
  message: string,
): Promise<void> {
  const db = drizzle(database, { schema: { tinypngTaskRuns, tinypngWorkerNodes } })
  const now = new Date()
  await db.insert(tinypngTaskRuns)
    .values({
      id: taskRunId,
      workerId: worker.id,
      cycleId,
      triggerType,
      scheduleSlot,
      status: 'failed',
      message,
      createdCount: 0,
      cleanedCount: 0,
      failedCount: 1,
      successfulCount: 0,
      startedAt: now,
      completedAt: now,
    })
    .onConflictDoNothing({ target: tinypngTaskRuns.id })
  await db.update(tinypngWorkerNodes)
    .set({
      lastStatus: 'failed',
      lastRunId: taskRunId,
      lastRunAt: now,
      lastError: message,
      updatedAt: now,
    })
    .where(eq(tinypngWorkerNodes.id, worker.id))
}

async function dispatchRegistrar(
  env: TinyPngPoolCoordinatorEnv,
  worker: TinyPngWorkerDefinition,
  payload: RegistrarRequestPayload,
): Promise<TinyPngPoolTaskResult> {
  const binding = worker.bindingName ? env[worker.bindingName] : undefined
  const taskRunId = `${payload.cycleId}:${worker.id}`

  if (!binding) {
    const message = `${worker.name} 缺少 Service Binding，未执行注册。`
    await markWorkerDispatchFailed(
      env.DB,
      worker,
      taskRunId,
      payload.cycleId,
      payload.triggerType,
      new Date(payload.scheduleSlot),
      message,
    )
    return createFailedWorkerResult(worker, payload.cycleId, new Date(payload.scheduleSlot), message)
  }

  try {
    const response = await binding.fetch('https://tinypng-pool.internal/run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
    const data = await response.json() as { result?: TinyPngPoolTaskResult; error?: string }
    if (!response.ok || !data.result) {
      throw new Error(data.error || `HTTP ${response.status}`)
    }
    return {
      ...data.result,
      startedAt: new Date(data.result.startedAt),
      completedAt: new Date(data.result.completedAt),
    }
  } catch (error) {
    const details = error instanceof Error ? error.message : String(error)
    const message = `${worker.name} 派发失败：${details}`
    await markWorkerDispatchFailed(
      env.DB,
      worker,
      taskRunId,
      payload.cycleId,
      payload.triggerType,
      new Date(payload.scheduleSlot),
      message,
    )
    return createFailedWorkerResult(worker, payload.cycleId, new Date(payload.scheduleSlot), message)
  }
}

export async function runTinyPngPoolCoordinator(
  env: TinyPngPoolCoordinatorEnv,
  options: TinyPngPoolCoordinatorOptions,
): Promise<TinyPngPoolCoordinatorResult> {
  const cycleId = getCycleId(options.triggerType, options.scheduledAt)
  const maintenance = await runTinyPngPoolMaintenanceTask(env.DB, {
    worker: TINYPNG_COORDINATOR_WORKER,
    cycleId,
    triggerType: options.triggerType,
    scheduleSlot: options.scheduledAt,
    taskRunId: `${cycleId}:${TINYPNG_COORDINATOR_WORKER.id}`,
  })

  if (maintenance.status === 'failed') {
    return summarizeTinyPngPoolCycle(cycleId, maintenance, [])
  }

  const db = drizzle(env.DB, { schema: { tinypngWorkerNodes } })
  const enabledNodes = await db.select({
    id: tinypngWorkerNodes.id,
  })
    .from(tinypngWorkerNodes)
    .where(and(
      eq(tinypngWorkerNodes.role, 'registrar'),
      eq(tinypngWorkerNodes.enabled, true),
    ))
    .all()
  const enabledNodeMap = new Map(enabledNodes.map((node) => [node.id, node]))
  const availableSlots = Math.max(TINYPNG_POOL_LIMIT - maintenance.poolSize, 0)
  const workers = TINYPNG_REGISTRAR_WORKERS
    .filter((worker) => enabledNodeMap.has(worker.id))
    .slice(0, availableSlots)

  const results = await Promise.all(
    workers.map((worker) => dispatchRegistrar(env, worker, {
      cycleId,
      triggerType: options.triggerType,
      scheduleSlot: options.scheduledAt.toISOString(),
      emailDomain: options.emailDomain,
    })),
  )

  return summarizeTinyPngPoolCycle(cycleId, maintenance, results)
}
