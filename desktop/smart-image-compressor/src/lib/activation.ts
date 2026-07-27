export function extractActivationCode(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'smartcompress:') return url.searchParams.get('code')?.trim() || trimmed
    if (url.protocol === 'https:') {
      const queryToken = url.searchParams.get('code') ?? url.searchParams.get('token')
      if (queryToken?.trim()) return queryToken.trim()

      const segments = url.pathname.split('/').filter(Boolean)
      if (segments.at(-2) === 'activate') return segments.at(-1)?.trim() || trimmed
    }
  } catch {
    // 手动粘贴的纯授权码无需按 URL 解析。
  }
  return trimmed
}
