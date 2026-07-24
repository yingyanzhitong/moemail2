import assert from 'node:assert/strict'
import test from 'node:test'

import onRequest, {
  UPSTREAM_ORIGIN,
} from '../edge-functions/api/[[path]].js'

test('转发允许的鉴权请求并保留鉴权信息、查询参数和上游响应', async (t) => {
  const originalFetch = globalThis.fetch
  let forwardedRequest
  globalThis.fetch = async (url, init) => {
    forwardedRequest = new Request(url, init)
    return new Response(JSON.stringify({ valid: true }), {
      status: 202,
      headers: {
        'content-type': 'application/json',
        'x-upstream': 'moemail',
      },
    })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const request = new Request(
    'https://relay.example.com/api/tinypng/desktop/grants/preview?locale=zh-CN',
    {
      method: 'POST',
      headers: {
        authorization: 'Bearer test-token',
        'content-type': 'application/json',
        host: 'relay.example.com',
        'x-api-key': 'test-api-key',
      },
      body: JSON.stringify({ code: 'grant-code' }),
    },
  )
  const response = await onRequest({ request })

  assert.equal(
    forwardedRequest.url,
    `${UPSTREAM_ORIGIN}/api/tinypng/desktop/grants/preview?locale=zh-CN`,
  )
  assert.equal(forwardedRequest.method, 'POST')
  assert.equal(forwardedRequest.headers.get('authorization'), 'Bearer test-token')
  assert.equal(forwardedRequest.headers.get('x-api-key'), 'test-api-key')
  assert.equal(forwardedRequest.headers.get('host'), null)
  assert.equal(forwardedRequest.headers.get('x-forwarded-host'), 'relay.example.com')
  assert.deepEqual(await forwardedRequest.json(), { code: 'grant-code' })
  assert.equal(response.status, 202)
  assert.equal(response.headers.get('x-upstream'), 'moemail')
  assert.equal(response.headers.get('x-moemail-relay'), 'edgeone')
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { valid: true })
})

test('兼容邮件生成接口', async (t) => {
  const originalFetch = globalThis.fetch
  let forwardedUrl
  globalThis.fetch = async (url) => {
    forwardedUrl = url.toString()
    return Response.json({ email: 'test@example.com' })
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const response = await onRequest({
    request: new Request('https://relay.example.com/api/emails/generate', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': 'test-api-key',
      },
      body: JSON.stringify({
        name: 'test',
        expiryTime: 3600000,
        domain: 'tinypng-token.site',
      }),
    }),
  })

  assert.equal(forwardedUrl, `${UPSTREAM_ORIGIN}/api/emails/generate`)
  assert.equal(response.status, 200)
})

test('拒绝白名单外的路径', async () => {
  const response = await onRequest({
    request: new Request('https://relay.example.com/api/admin/users'),
  })

  assert.equal(response.status, 404)
  assert.deepEqual(await response.json(), { error: 'Not found' })
})

test('拒绝不允许的请求方法并返回 Allow', async () => {
  const response = await onRequest({
    request: new Request('https://relay.example.com/api/tinypng/desktop/license', {
      method: 'POST',
    }),
  })

  assert.equal(response.status, 405)
  assert.equal(response.headers.get('allow'), 'GET')
})

test('上游网络异常时返回 502 且不暴露内部错误', async (t) => {
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => {
    throw new Error('internal network details')
  }
  t.after(() => {
    globalThis.fetch = originalFetch
  })

  const response = await onRequest({
    request: new Request('https://relay.example.com/api/tinypng/desktop/license'),
  })

  assert.equal(response.status, 502)
  assert.deepEqual(await response.json(), { error: 'Upstream service unavailable' })
})
