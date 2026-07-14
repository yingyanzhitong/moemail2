const PUBLIC_DESKTOP_API_PATHS = new Set([
  '/api/tinypng/electron-auth/redeem',
  '/api/tinypng/desktop/grants/preview',
  '/api/tinypng/desktop/redeem',
  '/api/tinypng/desktop/license',
  '/api/tinypng/desktop/keys/top-up',
])

export function isPublicDesktopApiPath(pathname: string): boolean {
  return PUBLIC_DESKTOP_API_PATHS.has(pathname) || pathname.startsWith('/api/tinypng/desktop/usage/')
}
