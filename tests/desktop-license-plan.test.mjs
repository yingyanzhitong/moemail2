import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { createDesktopGrant } from '../app/lib/desktop-license-service.ts'

function database(t) {
  const sqlite = new DatabaseSync(':memory:')
  t.after(() => sqlite.close())
  sqlite.exec(`CREATE TABLE tinypng_key_pool (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, api_key TEXT,
    status TEXT NOT NULL, error_message TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  )`)
  for (const migration of ['0026_desktop-licenses.sql', '0027_dynamic-desktop-grants.sql', '0028_brainy_callisto.sql', '0032_desktop-usage-metrics.sql']) {
    sqlite.exec(readFileSync(new URL(`../drizzle/${migration}`, import.meta.url), 'utf8'))
  }
  const insert = sqlite.prepare("INSERT INTO tinypng_key_pool VALUES (?, ?, ?, 'active', NULL, 1, 1)")
  for (let i = 0; i < 200; i++) insert.run(`key-${i}`, `key-${i}@example.test`, `api-key-${i}`)

  const d1 = {
    prepare(sql) {
      const statement = sqlite.prepare(sql)
      let bindings = []
      return {
        bind(...values) { bindings = values; return this },
        async raw() { statement.setReturnArrays(true); return statement.all(...bindings) },
        async all() { return { results: statement.all(...bindings) } },
        async run() { return { success: true, meta: statement.run(...bindings) } },
      }
    },
    async batch(statements) {
      sqlite.exec('BEGIN')
      try {
        const results = []
        for (const statement of statements) results.push(await statement.run())
        sqlite.exec('COMMIT')
        return results
      } catch (error) {
        sqlite.exec('ROLLBACK')
        throw error
      }
    },
  }
  return { sqlite, d1 }
}

test('创建 Auth Link 按 Token 数量生成默认额度并限制最大额度', async (t) => {
  const previousSecret = process.env.AUTH_SECRET
  process.env.AUTH_SECRET = 'desktop-plan-test-secret'
  t.after(() => {
    if (previousSecret === undefined) delete process.env.AUTH_SECRET
    else process.env.AUTH_SECRET = previousSecret
  })

  for (const [tokenCount, expectedLimit] of [[1, 250], [8, 2000], [40, 10000], [200, 50000]]) {
    await t.test(`${tokenCount} Token 默认 ${expectedLimit} 张并预留对应 Token`, async (t) => {
      const { sqlite, d1 } = database(t)
      const grant = await createDesktopGrant(d1, 'new', undefined, { tokenCount })
      assert.deepEqual(grant.plan, { tokenCount, compressionLimit: expectedLimit, durationDays: 30 })
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM tinypng_key_pool WHERE status = 'reserved'").get().count, tokenCount)
      assert.equal(sqlite.prepare('SELECT quota_total FROM desktop_activation_grants').get().quota_total, expectedLimit)
    })
  }

  await t.test('8 Token 允许自定义额度达到 4000 张', async (t) => {
    const { d1 } = database(t)
    const grant = await createDesktopGrant(d1, 'new', undefined, { tokenCount: 8, compressionLimit: 4000 })
    assert.equal(grant.plan.compressionLimit, 4000)
  })

  for (const compressionLimit of [0, 2000.5, 4001]) {
    await t.test(`8 Token 拒绝无效额度 ${compressionLimit} 且不预留 Token`, async (t) => {
      const { sqlite, d1 } = database(t)
      await assert.rejects(createDesktopGrant(d1, 'new', undefined, { tokenCount: 8, compressionLimit }), {
        code: 'INVALID_COMPRESSION_LIMIT', status: 400,
      })
      assert.equal(sqlite.prepare('SELECT COUNT(*) count FROM desktop_licenses').get().count, 0)
      assert.equal(sqlite.prepare("SELECT COUNT(*) count FROM tinypng_key_pool WHERE status = 'reserved'").get().count, 0)
    })
  }
})
