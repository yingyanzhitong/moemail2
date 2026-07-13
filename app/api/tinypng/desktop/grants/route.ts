import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/apiKey'
import { getUserRole } from '@/lib/auth'
import { createDesktopGrant } from '@/lib/desktop-license-service'
import { desktopApiError } from '@/lib/desktop-license-http'
import { DESKTOP_INITIAL_KEY_COUNT, DESKTOP_PERIOD_DAYS, DESKTOP_PERIOD_QUOTA, type DesktopGrantKind } from '@/lib/desktop-license-types'
import { ROLES } from '@/lib/permissions'

export const runtime = 'edge'

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await getUserRole(userId) !== ROLES.EMPEROR) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json() as { kind?: DesktopGrantKind; licenseId?: string }
    if (!body.kind || !['new', 'renew', 'rebind'].includes(body.kind)) {
      return NextResponse.json({ error: '凭证类型无效' }, { status: 400 })
    }
    const result = await createDesktopGrant(getRequestContext().env.DB, body.kind, body.licenseId)
    return NextResponse.json({
      success: true,
      licenseId: result.licenseId,
      authLink: new URL(`/activate/${result.code}`, request.url).toString(),
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
      plan: {
        days: DESKTOP_PERIOD_DAYS,
        limit: DESKTOP_PERIOD_QUOTA,
        initialKeyCount: DESKTOP_INITIAL_KEY_COUNT,
      },
    })
  } catch (error) {
    return desktopApiError(error, 'Failed to create desktop grant')
  }
}
