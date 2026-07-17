export type TinyPngWorkerRole = 'coordinator' | 'registrar'
export type TinyPngWorkerRunStatus = 'idle' | 'running' | 'success' | 'partial_failure' | 'skipped' | 'failed'

export interface TinyPngWorkerDefinition {
  id: string
  name: string
  role: TinyPngWorkerRole
  configuredRegion: string | null
  maintenanceOwner: boolean
  bindingName?: 'TINYPNG_REGISTRAR_APAC' | 'TINYPNG_REGISTRAR_AMERICAS' | 'TINYPNG_REGISTRAR_EUROPE'
}

export const TINYPNG_COORDINATOR_WORKER: TinyPngWorkerDefinition = {
  id: 'coordinator',
  name: '协调节点',
  role: 'coordinator',
  configuredRegion: null,
  maintenanceOwner: true,
}

export const TINYPNG_REGISTRAR_WORKERS: TinyPngWorkerDefinition[] = [
  {
    id: 'registrar-apac',
    name: '亚太注册节点',
    role: 'registrar',
    configuredRegion: 'aws:ap-southeast-1',
    maintenanceOwner: false,
    bindingName: 'TINYPNG_REGISTRAR_APAC',
  },
  {
    id: 'registrar-americas',
    name: '美洲注册节点',
    role: 'registrar',
    configuredRegion: 'aws:us-east-1',
    maintenanceOwner: false,
    bindingName: 'TINYPNG_REGISTRAR_AMERICAS',
  },
  {
    id: 'registrar-europe',
    name: '欧洲注册节点',
    role: 'registrar',
    configuredRegion: 'aws:eu-central-1',
    maintenanceOwner: false,
    bindingName: 'TINYPNG_REGISTRAR_EUROPE',
  },
]

export const TINYPNG_POOL_WORKERS = [
  TINYPNG_COORDINATOR_WORKER,
  ...TINYPNG_REGISTRAR_WORKERS,
]

export interface TinyPngRegistrarBindingEnv {
  TINYPNG_REGISTRAR_APAC?: Fetcher
  TINYPNG_REGISTRAR_AMERICAS?: Fetcher
  TINYPNG_REGISTRAR_EUROPE?: Fetcher
}

export function getTinyPngRegistrarTargets(env: TinyPngRegistrarBindingEnv) {
  return TINYPNG_REGISTRAR_WORKERS.flatMap((worker) => {
    const binding = worker.bindingName ? env[worker.bindingName] : undefined
    return binding ? [{ worker, binding }] : []
  })
}

export function getTinyPngWorkerDefinition(workerId: string): TinyPngWorkerDefinition | undefined {
  return TINYPNG_POOL_WORKERS.find((worker) => worker.id === workerId)
}
