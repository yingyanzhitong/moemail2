import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { getUserId } from '@/lib/apiKey'
import { getUserRole } from '@/lib/auth'
import { createDesktopGrant } from '@/lib/desktop-license-service'
import { desktopApiError } from '@/lib/desktop-license-http'
import type { DesktopGrantKind, DesktopGrantPlan } from '@/lib/desktop-license-types'
import { ROLES } from '@/lib/permissions'

export const runtime = 'edge'

export async function POST(request: Request) {
  const userId = await getUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (await getUserRole(userId) !== ROLES.EMPEROR) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  try {
    const body = await request.json() as { kind?: DesktopGrantKind; licenseId?: string } & Partial<DesktopGrantPlan>
    if (!body.kind || !['new', 'renew', 'rebind'].includes(body.kind)) {
      return NextResponse.json({ error: '凭证类型无效' }, { status: 400 })
    }
    const result = await createDesktopGrant(getRequestContext().env.DB, body.kind, body.licenseId, {
      tokenCount: body.tokenCount,
      compressionLimit: body.compressionLimit,
      durationDays: body.durationDays,
    })
    return NextResponse.json({
      success: true,
      licenseId: result.licenseId,
      authLink: new URL(`/activate/${result.code}`, request.url).toString(),
      code: result.code,
      expiresAt: result.expiresAt.toISOString(),
      plan: result.plan,
    })
  } catch (error) {
    return desktopApiError(error, 'Failed to create desktop grant')
  }
}
