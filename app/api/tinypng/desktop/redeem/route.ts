import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { redeemDesktopGrant } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { code?: string; deviceId?: string }
    if (!body.code || !body.deviceId) {
      return NextResponse.json({ error: '缺少授权码或设备标识' }, { status: 400 })
    }
    const result = await redeemDesktopGrant(getRequestContext().env.DB, body.code, body.deviceId)
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return desktopApiError(error, 'Failed to redeem desktop grant')
  }
}
