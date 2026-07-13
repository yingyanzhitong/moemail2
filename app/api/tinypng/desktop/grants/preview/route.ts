import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { previewDesktopGrant } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { code?: string }
    if (!body.code || body.code.length < 20 || body.code.length > 256) {
      return NextResponse.json({ error: '授权码格式无效' }, { status: 400 })
    }
    return NextResponse.json(await previewDesktopGrant(getRequestContext().env.DB, body.code))
  } catch (error) {
    return desktopApiError(error, 'Failed to preview desktop grant')
  }
}
