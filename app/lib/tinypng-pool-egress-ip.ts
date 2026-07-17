export const TINYPNG_EGRESS_IP_CHECK_URL = 'https://api64.ipify.org?format=json'
export const TINYPNG_EGRESS_IP_TIMEOUT_MS = 2000

export interface TinyPngEgressIpProbeResult {
  ip: string | null
  error: string | null
}

function normalizeIpAddress(value: unknown): string | null {
  if (typeof value !== 'string') return null

  const candidate = value.trim()
  const ipv4Parts = candidate.split('.')
  const isIpv4 = ipv4Parts.length === 4 && ipv4Parts.every((part) => (
    /^\d{1,3}$/.test(part) && Number(part) >= 0 && Number(part) <= 255
  ))
  if (isIpv4) return candidate

  const isIpv6 = candidate.length <= 45
    && candidate.includes(':')
    && /^[0-9a-f:.]+$/i.test(candidate)
  return isIpv6 ? candidate : null
}

export async function detectTinyPngEgressIp(
  fetcher: typeof fetch = fetch,
  timeoutMs = TINYPNG_EGRESS_IP_TIMEOUT_MS,
): Promise<TinyPngEgressIpProbeResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const response = await fetcher(TINYPNG_EGRESS_IP_CHECK_URL, {
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    })
    if (!response.ok) {
      throw new Error(`ipify 返回 HTTP ${response.status}`)
    }

    const payload = await response.json() as { ip?: unknown }
    const ip = normalizeIpAddress(payload.ip)
    if (!ip) throw new Error('ipify 返回的 IP 格式无效')

    return { ip, error: null }
  } catch (error) {
    const message = controller.signal.aborted
      ? `探测超时（${timeoutMs}ms）`
      : error instanceof Error
        ? error.message.substring(0, 160)
        : '未知错误'
    return { ip: null, error: message }
  } finally {
    clearTimeout(timeout)
  }
}

export function formatTinyPngEgressIpLog(result: TinyPngEgressIpProbeResult): string {
  return result.ip
    ? `观测出口 IP：${result.ip}（ipify；共享动态出口，仅用于排障）。`
    : `观测出口 IP：获取失败（${result.error || '未知错误'}）；继续执行任务。`
}
