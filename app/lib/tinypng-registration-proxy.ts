const TINYPNG_REGISTRATION_URL = new URL('https://tinify.com/web/api')
const PROXY_HOST = '198.12.67.119'
const PROXY_PORT = 18080
const PROXY_USERNAME = 'relay'
const RESPONSE_LIMIT = 1024 * 1024
export const TINYPNG_PROXY_TIMEOUT_MS = 10_000
const encoder = new TextEncoder()
const decoder = new TextDecoder()

export type TinyPngRegistrationMode = 'proxy' | 'direct'

type ProxySocket = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  close(): Promise<void>
}

type CloudflareSocketsModule = {
  connect(
    address: { hostname: string; port: number },
    options?: { secureTransport?: 'off' | 'on' },
  ): ProxySocket
}

async function getSocketConnector(): Promise<CloudflareSocketsModule['connect']> {
  const sockets = await import(
    /* webpackIgnore: true */
    'cloudflare:sockets'
  ) as CloudflareSocketsModule
  return sockets.connect
}

class TinyPngProxyTimeoutError extends Error {
  constructor() {
    super(`TinyPNG 注册中转服务超时（${TINYPNG_PROXY_TIMEOUT_MS / 1000} 秒）`)
    this.name = 'TinyPngProxyTimeoutError'
  }
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0)
  const result = new Uint8Array(length)
  let offset = 0

  for (const chunk of chunks) {
    result.set(chunk, offset)
    offset += chunk.length
  }

  return result
}

function findBytes(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index <= haystack.length - needle.length; index++) {
    let matches = true
    for (let offset = 0; offset < needle.length; offset++) {
      if (haystack[index + offset] !== needle[offset]) {
        matches = false
        break
      }
    }
    if (matches) return index
  }

  return -1
}

async function readAll(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0

  while (true) {
    const { done, value } = await reader.read()
    if (done) return concatBytes(chunks)
    if (!value) continue

    length += value.length
    if (length > limit) throw new Error('TinyPNG 注册响应过大')
    chunks.push(value)
  }
}

function decodeChunkedBody(body: Uint8Array): Uint8Array {
  const chunks: Uint8Array[] = []
  let offset = 0
  const lineEnd = encoder.encode('\r\n')

  while (offset < body.length) {
    const sizeEnd = findBytes(body.slice(offset), lineEnd)
    if (sizeEnd === -1) throw new Error('TinyPNG 返回了无效的分块响应')

    const sizeLineEnd = offset + sizeEnd
    const size = Number.parseInt(
      decoder.decode(body.slice(offset, sizeLineEnd)).split(';', 1)[0].trim(),
      16,
    )
    if (!Number.isFinite(size) || size < 0) throw new Error('TinyPNG 返回了无效的分块长度')

    offset = sizeLineEnd + lineEnd.length
    if (size === 0) return concatBytes(chunks)
    if (offset + size + lineEnd.length > body.length) {
      throw new Error('TinyPNG 分块响应不完整')
    }

    chunks.push(body.slice(offset, offset + size))
    offset += size
    if (findBytes(body.slice(offset, offset + lineEnd.length), lineEnd) !== 0) {
      throw new Error('TinyPNG 分块响应格式错误')
    }
    offset += lineEnd.length
  }

  throw new Error('TinyPNG 分块响应缺少结束标记')
}

function parseHttpResponse(rawResponse: Uint8Array): Response {
  const delimiter = encoder.encode('\r\n\r\n')
  const headerEnd = findBytes(rawResponse, delimiter)
  if (headerEnd === -1) throw new Error('TinyPNG 返回了无效的 HTTP 响应')

  const lines = decoder.decode(rawResponse.slice(0, headerEnd)).split('\r\n')
  const [, statusCode, statusText = ''] = /^HTTP\/\d(?:\.\d)?\s+(\d{3})(?:\s+(.*))?$/.exec(lines[0]) ?? []
  const status = Number(statusCode)
  if (!Number.isInteger(status) || status < 200 || status > 599) {
    throw new Error('TinyPNG 返回了无效的 HTTP 状态码')
  }

  const headers = new Headers()
  let isChunked = false
  for (const line of lines.slice(1)) {
    const separator = line.indexOf(':')
    if (separator === -1) continue

    const name = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim()
    if (!name) continue
    if (name.toLowerCase() === 'transfer-encoding') {
      isChunked = value.toLowerCase() === 'chunked'
      continue
    }
    headers.append(name, value)
  }

  const body = rawResponse.slice(headerEnd + delimiter.length)
  const responseBody = isChunked
    ? decodeChunkedBody(body)
    : body
  headers.delete('content-length')

  return new Response(responseBody.length > 0 ? responseBody : null, {
    status,
    statusText,
    headers,
  })
}

async function requestTinyPngRegistrationViaProxy(
  email: string,
  proxyToken: string,
): Promise<Response> {
  const proxyAuthorization = btoa(`${PROXY_USERNAME}:${proxyToken}`)
  const body = JSON.stringify({ fullName: email, mail: email })
  let socket: ProxySocket | undefined
  let timedOut = false
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  const request = (async () => {
    const connect = await getSocketConnector()
    socket = connect(
      { hostname: PROXY_HOST, port: PROXY_PORT },
      { secureTransport: 'off' },
    )
    if (timedOut) {
      void socket.close().catch(() => undefined)
      throw new TinyPngProxyTimeoutError()
    }

    const requestWriter = socket.writable.getWriter()
    await requestWriter.write(encoder.encode([
      `POST ${TINYPNG_REGISTRATION_URL.href} HTTP/1.1`,
      `Host: ${TINYPNG_REGISTRATION_URL.host}`,
      `Proxy-Authorization: Basic ${proxyAuthorization}`,
      'Content-Type: application/json',
      'Accept: application/json, text/plain, */*',
      'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'Origin: https://tinify.com',
      'Referer: https://tinify.com/developers',
      `Content-Length: ${encoder.encode(body).byteLength}`,
      'Connection: close',
      '',
      body,
    ].join('\r\n')))
    requestWriter.releaseLock()

    const responseReader = socket.readable.getReader()
    const response = await readAll(responseReader, RESPONSE_LIMIT)
    responseReader.releaseLock()
    return parseHttpResponse(response)
  })()

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      timedOut = true
      void socket?.close().catch(() => undefined)
      reject(new TinyPngProxyTimeoutError())
    }, TINYPNG_PROXY_TIMEOUT_MS)
  })

  try {
    return await Promise.race([request, timeout])
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId)
    void socket?.close().catch(() => undefined)
  }
}

async function requestTinyPngRegistrationDirect(email: string): Promise<Response> {
  const body = JSON.stringify({ fullName: email, mail: email })

  return fetch(TINYPNG_REGISTRATION_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/plain, */*',
      'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
      'Origin': 'https://tinify.com',
      'Referer': 'https://tinify.com/developers',
    },
    body,
  })
}

export async function requestTinyPngRegistrationWithProxyFallback(
  requestViaProxy: () => Promise<Response>,
  requestDirect: () => Promise<Response>,
  onProxyFallback?: (error: Error) => void | Promise<void>,
): Promise<Response> {
  try {
    const response = await requestViaProxy()
    if (response.status === 502) {
      throw new Error('TinyPNG 注册中转服务返回 HTTP 502')
    }
    return response
  } catch (error) {
    const proxyError = error instanceof Error ? error : new Error(String(error))
    if (onProxyFallback) {
      try {
        await onProxyFallback(proxyError)
      } catch (logError) {
        console.warn('[TinyPNG] 中转降级日志写入失败：', logError)
      }
    } else {
      console.warn('[TinyPNG] 中转服务失败，已改为直连 TinyPNG：', proxyError.message)
    }
    return requestDirect()
  }
}

/**
 * 按配置通过固定 HTTP 中转或直连 TinyPNG 提交注册请求；中转连接或响应超过 10 秒时自动改为直连。
 */
export async function requestTinyPngRegistration(
  email: string,
  proxyToken: string | undefined,
  registrationMode: TinyPngRegistrationMode = 'proxy',
  onProxyFallback?: (error: Error) => void | Promise<void>,
): Promise<Response> {
  if (!email || /[\r\n]/.test(email)) throw new Error('TinyPNG 注册邮箱格式无效')

  if (registrationMode === 'direct') {
    return requestTinyPngRegistrationDirect(email)
  }

  if (!proxyToken) throw new Error('未配置 TinyPNG 注册代理令牌')

  return requestTinyPngRegistrationWithProxyFallback(
    () => requestTinyPngRegistrationViaProxy(email, proxyToken),
    () => requestTinyPngRegistrationDirect(email),
    onProxyFallback,
  )
}
