import { runTinyPngPoolRegistrationTask, type TinyPngTaskTriggerType } from '../app/lib/tinypng-pool-task'
import { getTinyPngWorkerDefinition } from '../app/lib/tinypng-pool-workers'

interface RegistrarEnv {
  DB: D1Database
  WORKER_ID: string
  WORKER_NAME: string
  WORKER_REGION: string
  TINYPNG_PROXY_TOKEN?: string
}

interface RegistrarRequestPayload {
  cycleId?: string
  triggerType?: TinyPngTaskTriggerType
  scheduleSlot?: string
  emailDomain?: string
}

export default {
  async fetch(request: Request, env: RegistrarEnv): Promise<Response> {
    const url = new URL(request.url)
    if (request.method !== 'POST' || url.pathname !== '/run') {
      return new Response('Not Found', { status: 404 })
    }

    const payload = await request.json() as RegistrarRequestPayload
    if (
      !payload.cycleId
      || !payload.scheduleSlot
      || !payload.emailDomain
      || !['scheduled', 'manual'].includes(payload.triggerType || '')
    ) {
      return Response.json({ error: '区域注册任务参数不完整' }, { status: 400 })
    }

    const registeredWorker = getTinyPngWorkerDefinition(env.WORKER_ID)
    const worker = registeredWorker?.role === 'registrar'
      ? registeredWorker
      : {
          id: env.WORKER_ID,
          name: env.WORKER_NAME,
          role: 'registrar' as const,
          configuredRegion: env.WORKER_REGION,
          maintenanceOwner: false,
        }

    const result = await runTinyPngPoolRegistrationTask(env.DB, payload.emailDomain, {
      worker,
      cycleId: payload.cycleId,
      triggerType: payload.triggerType as TinyPngTaskTriggerType,
      scheduleSlot: new Date(payload.scheduleSlot),
      placement: request.headers.get('cf-placement')
        || (request as Request & { cf?: { colo?: string } }).cf?.colo
        || null,
      taskRunId: `${payload.cycleId}:${worker.id}`,
      proxyToken: env.TINYPNG_PROXY_TOKEN,
    })

    return Response.json({ result })
  },
}
