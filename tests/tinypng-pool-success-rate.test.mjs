import assert from 'node:assert/strict'
import test from 'node:test'

import { calculateTinyPngRegistrationSuccessRate } from '../app/lib/tinypng-pool-success-rate.ts'

test('按成功账号数和本次创建账号数计算 TinyPNG 注册成功率', () => {
  assert.equal(calculateTinyPngRegistrationSuccessRate(1, 5), 20)
  assert.equal(calculateTinyPngRegistrationSuccessRate(1, 3), 33.3)
  assert.equal(calculateTinyPngRegistrationSuccessRate(5, 5), 100)
})

test('本次没有创建账号时不提供注册成功率', () => {
  assert.equal(calculateTinyPngRegistrationSuccessRate(0, 0), null)
})
