import assert from 'node:assert/strict'
import test from 'node:test'

import { requestTinyPngRegistration } from '../app/lib/tinypng-registration-proxy.ts'

test('未配置代理令牌时注册请求会失败，不会回退为直连', async () => {
  await assert.rejects(
    requestTinyPngRegistration('tiny@example.com', undefined),
    /未配置 TinyPNG 注册代理令牌/,
  )
})
