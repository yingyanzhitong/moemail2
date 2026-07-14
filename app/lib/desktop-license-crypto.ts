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

const GRANT_CODE_AAD = new TextEncoder().encode('desktop-activation-grant:v1')

function encodeBase64Url(bytes: Uint8Array): string {
  const binary = Array.from(bytes, (byte) => String.fromCharCode(byte)).join('')
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function decodeBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Uint8Array.from(atob(padded), (character) => character.charCodeAt(0))
}

async function grantEncryptionKey(secret: string, usage: KeyUsage[]): Promise<CryptoKey> {
  if (!secret) throw new Error('授权加密密钥未配置')
  const keyMaterial = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(secret))
  return crypto.subtle.importKey('raw', keyMaterial, { name: 'AES-GCM' }, false, usage)
}

export async function encryptDesktopGrantCode(code: string, secret: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await grantEncryptionKey(secret, ['encrypt'])
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: GRANT_CODE_AAD },
    key,
    new TextEncoder().encode(code),
  )
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(new Uint8Array(encrypted))}`
}

export async function decryptDesktopGrantCode(payload: string, secret: string): Promise<string> {
  const [version, ivValue, encryptedValue] = payload.split('.')
  if (version !== 'v1' || !ivValue || !encryptedValue) throw new Error('授权码密文格式无效')
  const key = await grantEncryptionKey(secret, ['decrypt'])
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: decodeBase64Url(ivValue), additionalData: GRANT_CODE_AAD },
    key,
    decodeBase64Url(encryptedValue),
  )
  return new TextDecoder().decode(decrypted)
}
