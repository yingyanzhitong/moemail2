export function createDesktopSecret(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength)
  crypto.getRandomValues(bytes)
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')

  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}
