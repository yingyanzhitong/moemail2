import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/apiKey'
import { getUserRole } from '@/lib/auth'
import { desktopApiError } from '@/lib/desktop-license-http'
import { getOrRotateDesktopAuthLinkCode } from '@/lib/desktop-license-service'
import { ROLES } from '@/lib/permissions'

export const runtime = 'edge'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await getUserRole(userId) !== ROLES.EMPEROR) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const { id } = await params
    const result = await getOrRotateDesktopAuthLinkCode(getRequestContext().env.DB, id)
    return NextResponse.json({
      authLink: new URL(`/activate/${result.code}`, request.url).toString(),
      expiresAt: result.expiresAt.toISOString(),
    }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch (error) {
    return desktopApiError(error, 'Failed to get desktop auth link')
  }
}
