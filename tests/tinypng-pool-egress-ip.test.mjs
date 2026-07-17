import assert from 'node:assert/strict'
import test from 'node:test'

import {
  detectTinyPngEgressIp,
  formatTinyPngEgressIpLog,
  TINYPNG_EGRESS_IP_CHECK_URL,
} from '../app/lib/tinypng-pool-egress-ip.ts'

test('出口 IP 探测接受 ipify 返回的 IPv4 和 IPv6', async () => {
  const seenUrls = []
  const ipv4 = await detectTinyPngEgressIp(async (url) => {
    seenUrls.push(String(url))
    return Response.json({ ip: '203.0.113.24' })
  })
  const ipv6 = await detectTinyPngEgressIp(async () => Response.json({ ip: '2001:db8::24' }))

  assert.deepEqual(ipv4, { ip: '203.0.113.24', error: null })
  assert.deepEqual(ipv6, { ip: '2001:db8::24', error: null })
  assert.deepEqual(seenUrls, [TINYPNG_EGRESS_IP_CHECK_URL])
})

test('出口 IP 探测拒绝异常内容，失败日志不会中断任务', async () => {
  const result = await detectTinyPngEgressIp(async () => Response.json({ ip: '<script>' }))

  assert.equal(result.ip, null)
  assert.match(result.error, /IP 格式无效/)
  assert.match(formatTinyPngEgressIpLog(result), /获取失败/)
  assert.match(formatTinyPngEgressIpLog(result), /继续执行任务/)
})

test('出口 IP 探测超时会主动取消请求', async () => {
  const result = await detectTinyPngEgressIp((_url, init) => new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      reject(new DOMException('Aborted', 'AbortError'))
    })
  }), 5)

  assert.deepEqual(result, { ip: null, error: '探测超时（5ms）' })
})

test('成功日志明确标记为共享动态出口', () => {
  const message = formatTinyPngEgressIpLog({ ip: '203.0.113.24', error: null })

  assert.match(message, /观测出口 IP：203\.0\.113\.24/)
  assert.match(message, /共享动态出口/)
})
