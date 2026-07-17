import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { DatabaseSync } from 'node:sqlite'

import { summarizeTinyPngCycleRuns } from '../app/lib/tinypng-pool-cycle-summary.ts'
import {
  TINYPNG_POOL_WORKERS,
  TINYPNG_REGISTRAR_WORKERS,
} from '../app/lib/tinypng-pool-workers.ts'
import { resolveTinyPngWorkerEmailDomain } from '../app/lib/tinypng-pool-domain.ts'

test('Worker 注册表只有一个清理节点，三个注册节点使用不同区域', () => {
  assert.equal(TINYPNG_POOL_WORKERS.length, 4)
  assert.equal(new Set(TINYPNG_POOL_WORKERS.map((worker) => worker.id)).size, 4)
  assert.equal(TINYPNG_POOL_WORKERS.filter((worker) => worker.maintenanceOwner).length, 1)
  assert.equal(TINYPNG_REGISTRAR_WORKERS.length, 3)
  assert.equal(new Set(TINYPNG_REGISTRAR_WORKERS.map((worker) => worker.configuredRegion)).size, 3)
})

test('区域节点优先使用独立邮箱域名，未配置时回退到默认域名', () => {
  assert.equal(resolveTinyPngWorkerEmailDomain('europe.example.com', 'default.example.com'), 'europe.example.com')
  assert.equal(resolveTinyPngWorkerEmailDomain(null, 'default.example.com'), 'default.example.com')
  assert.equal(resolveTinyPngWorkerEmailDomain('  ', 'default.example.com'), 'default.example.com')
})

test('上一轮集群任务按区域节点聚合，不把维护节点算作注册成功', () => {
  const startedAt = new Date('2026-07-17T04:00:00.000Z')
  const completedAt = new Date('2026-07-17T04:00:05.000Z')
  const run = (overrides) => ({
    id: 'run',
    workerId: 'coordinator',
    cycleId: 'scheduled:2026-07-17T04:00:00.000Z',
    status: 'success',
    message: 'ok',
    createdCount: 0,
    cleanedCount: 0,
    failedCount: 0,
    successfulCount: 0,
    startedAt,
    completedAt,
    ...overrides,
  })

  const summary = summarizeTinyPngCycleRuns([
    run({ id: 'maintenance', cleanedCount: 2 }),
    run({ id: 'apac', workerId: 'registrar-apac', createdCount: 1, successfulCount: 1 }),
    run({ id: 'americas', workerId: 'registrar-americas', status: 'failed', createdCount: 1, failedCount: 1 }),
    run({ id: 'europe', workerId: 'registrar-europe', createdCount: 1, successfulCount: 1 }),
  ])

  assert.equal(summary.status, 'partial_failure')
  assert.equal(summary.createdCount, 3)
  assert.equal(summary.successfulCount, 2)
  assert.equal(summary.failedCount, 1)
  assert.equal(summary.cleanedCount, 2)
})

test('D1 迁移创建并初始化 Worker 节点', () => {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE tinypng_task_runs (
    id TEXT PRIMARY KEY NOT NULL,
    status TEXT NOT NULL,
    message TEXT NOT NULL,
    created_count INTEGER DEFAULT 0 NOT NULL,
    cleaned_count INTEGER DEFAULT 0 NOT NULL,
    failed_count INTEGER DEFAULT 0 NOT NULL,
    successful_count INTEGER DEFAULT 0 NOT NULL,
    started_at INTEGER NOT NULL,
    completed_at INTEGER NOT NULL
  )`)
  db.exec(readFileSync(new URL('../drizzle/0029_tinypng-worker-cluster.sql', import.meta.url), 'utf8'))
  db.exec(readFileSync(new URL('../drizzle/0030_tinypng-worker-email-domains.sql', import.meta.url), 'utf8'))

  assert.equal(db.prepare('SELECT COUNT(*) count FROM tinypng_worker_nodes').get().count, 4)
  assert.equal(db.prepare('SELECT COUNT(*) count FROM tinypng_worker_nodes WHERE maintenance_owner = 1').get().count, 1)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pragma_table_info('tinypng_worker_nodes') WHERE name = 'email_domain'").get().count, 1)
  assert.equal(db.prepare("SELECT COUNT(*) count FROM pragma_table_info('tinypng_task_runs') WHERE name IN ('worker_id', 'cycle_id', 'placement')").get().count, 3)
})

test('三个区域 Worker 配置均使用 fetch 入口与独立 Placement Hint', () => {
  const configs = ['apac', 'americas', 'europe'].map((region) => JSON.parse(readFileSync(
    new URL(`../wrangler.tinypng.registrar-${region}.example.json`, import.meta.url),
    'utf8',
  )))

  assert.equal(new Set(configs.map((config) => config.name)).size, 3)
  assert.equal(new Set(configs.map((config) => config.placement.region)).size, 3)
  assert.ok(configs.every((config) => config.main === 'workers/tinypng-pool-registrar.ts'))
  assert.ok(configs.every((config) => config.workers_dev === false))
})
