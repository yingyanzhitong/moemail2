import assert from 'node:assert/strict'
import test from 'node:test'

import {
  requestTinyPngRegistration,
  requestTinyPngRegistrationWithProxyFallback,
} from '../app/lib/tinypng-registration-proxy.ts'

test('未配置代理令牌时注册请求会失败，不会回退为直连', async () => {
  await assert.rejects(
    requestTinyPngRegistration('tiny@example.com', undefined),
    /未配置 TinyPNG 注册代理令牌/,
  )
})

test('选择直连时不需要中转令牌', async () => {
  const originalFetch = globalThis.fetch
  const requests = []
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), init })
    return new Response(null, { status: 201 })
  }

  try {
    const response = await requestTinyPngRegistration('tiny@example.com', undefined, 'direct')
    assert.equal(response.status, 201)
    assert.equal(requests.length, 1)
    assert.equal(requests[0].input, 'https://tinify.com/web/api')
  } finally {
    globalThis.fetch = originalFetch
  }
})

test('中转服务异常时会记录原因并改为直连 TinyPNG', async () => {
  const fallbackErrors = []
  const response = await requestTinyPngRegistrationWithProxyFallback(
    async () => {
      throw new Error('TinyPNG 注册中转服务超时（10 秒）')
    },
    async () => new Response(null, { status: 201 }),
    async (error) => {
      fallbackErrors.push(error.message)
    },
  )

  assert.equal(response.status, 201)
  assert.deepEqual(fallbackErrors, ['TinyPNG 注册中转服务超时（10 秒）'])
})

test('中转服务返回 HTTP 502 时会改为直连 TinyPNG', async () => {
  const fallbackErrors = []
  const response = await requestTinyPngRegistrationWithProxyFallback(
    async () => new Response(null, { status: 502 }),
    async () => new Response(null, { status: 201 }),
    async (error) => {
      fallbackErrors.push(error.message)
    },
  )

  assert.equal(response.status, 201)
  assert.deepEqual(fallbackErrors, ['TinyPNG 注册中转服务返回 HTTP 502'])
})
