const UPSTREAM_ORIGIN = 'https://snapmail.tinypng-token.site'

const ALLOWED_ROUTES = new Map([
  ['/api/emails/generate', new Set(['POST'])],
  ['/api/tinypng/desktop/grants/preview', new Set(['POST'])],
  ['/api/tinypng/desktop/license', new Set(['GET'])],
  ['/api/tinypng/desktop/redeem', new Set(['POST'])],
  ['/api/tinypng/desktop/usage/reports', new Set(['POST'])],
  ['/api/tinypng/desktop/usage/session', new Set(['POST'])],
])

const HOP_BY_HOP_HEADERS = [
  'connection',
  'host',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]

function jsonResponse(body, status, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'cache-control': 'no-store',
      'content-type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  })
}

function proxyHeaders(request) {
  const headers = new Headers(request.headers)
  for (const name of HOP_BY_HOP_HEADERS) {
    headers.delete(name)
  }
  headers.set('x-forwarded-host', new URL(request.url).host)
  headers.set('x-forwarded-proto', 'https')
  return headers
}

export default async function onRequest({ request }) {
  const requestUrl = new URL(request.url)
  const methods = ALLOWED_ROUTES.get(requestUrl.pathname)

  if (!methods) {
    return jsonResponse({ error: 'Not found' }, 404)
  }

  if (!methods.has(request.method)) {
    return jsonResponse(
      { error: 'Method not allowed' },
      405,
      { allow: [...methods].join(', ') },
    )
  }

  const upstreamUrl = new URL(`${requestUrl.pathname}${requestUrl.search}`, UPSTREAM_ORIGIN)
  const init = {
    method: request.method,
    headers: proxyHeaders(request),
    redirect: 'manual',
  }
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = await request.arrayBuffer()
  }

  try {
    const upstreamResponse = await fetch(upstreamUrl, init)
    const responseHeaders = new Headers(upstreamResponse.headers)
    for (const name of HOP_BY_HOP_HEADERS) {
      responseHeaders.delete(name)
    }
    responseHeaders.set('cache-control', 'no-store')
    responseHeaders.set('x-moemail-relay', 'edgeone')

    return new Response(upstreamResponse.body, {
      status: upstreamResponse.status,
      statusText: upstreamResponse.statusText,
      headers: responseHeaders,
    })
  } catch {
    return jsonResponse({ error: 'Upstream service unavailable' }, 502)
  }
}

export { ALLOWED_ROUTES, UPSTREAM_ORIGIN }
