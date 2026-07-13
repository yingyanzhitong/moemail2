import assert from 'node:assert/strict'
import test from 'node:test'

import {
  getNextTinyPngPoolRunAt,
  getTinyPngPoolScheduleLabel,
  isValidTinyPngPoolCronExpression,
  normalizeTinyPngPoolCronExpression,
  parseTinyPngPoolCronExpression,
  shouldRunTinyPngPoolScheduledTask,
} from '../app/lib/tinypng-pool-schedule.ts'

test('支持常用 Linux 五段 Cron 数字语法', () => {
  assert.equal(isValidTinyPngPoolCronExpression('0 * * * *'), true)
  assert.equal(isValidTinyPngPoolCronExpression('*/15 9-18 * * 1-5'), true)
  assert.equal(isValidTinyPngPoolCronExpression('0 0 1,15 * *'), true)
  assert.equal(isValidTinyPngPoolCronExpression('0 */6 * * *'), true)
  assert.equal(isValidTinyPngPoolCronExpression('0 * * *'), false)
  assert.equal(isValidTinyPngPoolCronExpression('60 * * * *'), false)
  assert.equal(isValidTinyPngPoolCronExpression('*/0 * * * *'), false)
})

test('Cron 配置会规范空格，无效配置回退到每小时', () => {
  assert.equal(normalizeTinyPngPoolCronExpression('  0   */6  * * * '), '0 */6 * * *')
  assert.equal(parseTinyPngPoolCronExpression(null), '0 * * * *')
  assert.equal(parseTinyPngPoolCronExpression('invalid'), '0 * * * *')
})

test('Cron 按北京时间匹配，并支持工作日范围', () => {
  const beijingMonday17 = new Date('2026-07-13T09:00:00.000Z')
  assert.equal(shouldRunTinyPngPoolScheduledTask(beijingMonday17, '0 17 * * 1-5'), true)
  assert.equal(shouldRunTinyPngPoolScheduledTask(beijingMonday17, '0 9 * * *'), false)
})

test('下一次任务时间由 Cron 表达式计算', () => {
  const from = new Date('2026-07-13T08:30:00.000Z')
  assert.equal(getNextTinyPngPoolRunAt(from, '0 */6 * * *').toISOString(), '2026-07-13T10:00:00.000Z')
  assert.equal(getNextTinyPngPoolRunAt(from, '30 9 * * *').toISOString(), '2026-07-14T01:30:00.000Z')
  assert.equal(getNextTinyPngPoolRunAt(from, '0 0 * * *').toISOString(), '2026-07-13T16:00:00.000Z')
  assert.equal(getTinyPngPoolScheduleLabel('0 */6 * * *'), '0 */6 * * *（Linux Cron，北京时间）')
  assert.throws(
    () => getNextTinyPngPoolRunAt(from, '0 0 31 2 *'),
    /未来 5 年内没有匹配/,
  )
})
