const TINYPNG_REGISTRATION_URL = new URL('https://tinify.com/web/api')
const PROXY_HOST = '198.12.67.119'
const PROXY_PORT = 18080
const PROXY_USERNAME = 'relay'
const CONNECT_RESPONSE_LIMIT = 16 * 1024
const RESPONSE_LIMIT = 1024 * 1024
const encoder = new TextEncoder()
const decoder = new TextDecoder()

type ProxySocket = {
  readable: ReadableStream<Uint8Array>
  writable: WritableStream<Uint8Array>
  close(): Promise<void>
  startTls(options?: { expectedServerHostname?: string }): ProxySocket
}

type CloudflareSocketsModule = {
  connect(address: { hostname: string; port: number }): ProxySocket
}

async function getSocketConnector(): Promise<CloudflareSocketsModule['connect']> {
  const sockets = await import(
    /* webpackIgnore: true */
    'cloudflare:sockets'
  ) as CloudflareSocketsModule
  return sockets.connect
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

async function readUntil(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  delimiter: Uint8Array,
  limit: number,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  let length = 0

  while (length <= limit) {
    const { done, value } = await reader.read()
    if (done) break
    if (!value) continue

    chunks.push(value)
    length += value.length
    if (length > limit) throw new Error('代理 CONNECT 响应过大')
    const received = concatBytes(chunks)
    if (findBytes(received, delimiter) !== -1) return received
  }

  throw new Error('代理未返回完整的 CONNECT 响应')
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

function parseConnectResponse(response: Uint8Array): void {
  const delimiter = encoder.encode('\r\n\r\n')
  const headerEnd = findBytes(response, delimiter)
  if (headerEnd === -1) throw new Error('代理返回了无效的 CONNECT 响应')
  if (headerEnd + delimiter.length !== response.length) {
    throw new Error('代理 CONNECT 响应包含意外数据')
  }

  const statusLine = decoder.decode(response.slice(0, headerEnd)).split('\r\n')[0]
  const status = /^HTTP\/\d(?:\.\d)?\s+(\d{3})\b/.exec(statusLine)?.[1]
  if (status !== '200') throw new Error(`代理 CONNECT 失败: ${statusLine}`)
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

/**
 * 使用固定 HTTP 代理向 TinyPNG 提交注册请求。令牌仅应来自 Worker 运行时 Secret。
 */
export async function requestTinyPngRegistration(
  email: string,
  proxyToken: string | undefined,
): Promise<Response> {
  if (!proxyToken) throw new Error('未配置 TinyPNG 注册代理令牌')
  if (!email || /[\r\n]/.test(email)) throw new Error('TinyPNG 注册邮箱格式无效')

  const proxyAuthorization = btoa(`${PROXY_USERNAME}:${proxyToken}`)
  const body = JSON.stringify({ fullName: email, mail: email })
  const connect = await getSocketConnector()
  const socket = connect({ hostname: PROXY_HOST, port: PROXY_PORT })
  let activeSocket = socket

  try {
    const proxyWriter = socket.writable.getWriter()
    await proxyWriter.write(encoder.encode([
      `CONNECT ${TINYPNG_REGISTRATION_URL.hostname}:443 HTTP/1.1`,
      `Host: ${TINYPNG_REGISTRATION_URL.hostname}:443`,
      `Proxy-Authorization: Basic ${proxyAuthorization}`,
      'Proxy-Connection: keep-alive',
      '',
      '',
    ].join('\r\n')))
    proxyWriter.releaseLock()

    const proxyReader = socket.readable.getReader()
    const connectResponse = await readUntil(
      proxyReader,
      encoder.encode('\r\n\r\n'),
      CONNECT_RESPONSE_LIMIT,
    )
    proxyReader.releaseLock()
    parseConnectResponse(connectResponse)

    const secureSocket = socket.startTls({ expectedServerHostname: TINYPNG_REGISTRATION_URL.hostname })
    activeSocket = secureSocket
    const requestWriter = secureSocket.writable.getWriter()
    await requestWriter.write(encoder.encode([
      `POST ${TINYPNG_REGISTRATION_URL.pathname} HTTP/1.1`,
      `Host: ${TINYPNG_REGISTRATION_URL.host}`,
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
    await requestWriter.close()

    const responseReader = secureSocket.readable.getReader()
    const response = await readAll(responseReader, RESPONSE_LIMIT)
    responseReader.releaseLock()
    return parseHttpResponse(response)
  } finally {
    await activeSocket.close().catch(() => undefined)
  }
}
