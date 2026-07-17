import assert from 'node:assert/strict'
import test from 'node:test'

import { groupTinyPngTaskLogs } from '../app/lib/tinypng-pool-log-columns.ts'

test('TinyPNG 日志按四个 Worker 标记分列，并保留多行内容', () => {
  const grouped = groupTinyPngTaskLogs([
    '[coordinator]',
    '维护完成。',
    '[registrar-apac] 亚太节点摘要。',
    '[time] 亚太第一步。\n亚太第二步。',
    '[registrar-europe]',
    '欧洲节点摘要。',
    '[registrar-americas] 美洲节点摘要。',
  ])

  assert.deepEqual(grouped.coordinator, ['维护完成。'])
  assert.deepEqual(grouped['registrar-apac'], [
    '亚太节点摘要。',
    '[time] 亚太第一步。\n亚太第二步。',
  ])
  assert.deepEqual(grouped['registrar-europe'], ['欧洲节点摘要。'])
  assert.deepEqual(grouped['registrar-americas'], ['美洲节点摘要。'])
})

test('尚未出现 Worker 标记的启动提示归入协调节点列', () => {
  const grouped = groupTinyPngTaskLogs([
    '正在创建任务记录，日志会自动刷新。',
    '协调节点将先执行一次维护。',
  ])

  assert.equal(grouped.coordinator.length, 2)
  assert.equal(grouped['registrar-apac'].length, 0)
  assert.equal(grouped['registrar-europe'].length, 0)
  assert.equal(grouped['registrar-americas'].length, 0)
})
