import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/apiKey'
import { getUserRole } from '@/lib/auth'
import { desktopApiError } from '@/lib/desktop-license-http'
import { revokeDesktopLicense } from '@/lib/desktop-license-service'
import { ROLES } from '@/lib/permissions'

export const runtime = 'edge'

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await getUserRole(userId) !== ROLES.EMPEROR) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  try {
    const { id } = await params
    await revokeDesktopLicense(getRequestContext().env.DB, id)
    return NextResponse.json({ success: true })
  } catch (error) {
    return desktopApiError(error, 'Failed to revoke desktop license')
  }
}
