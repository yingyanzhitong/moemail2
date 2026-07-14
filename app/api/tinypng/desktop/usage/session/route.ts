import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { createDesktopUsageSession } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      licenseId?: string
      deviceId?: string
      apiKey?: string
    }
    const result = await createDesktopUsageSession(getRequestContext().env.DB, {
      licenseId: body.licenseId ?? '',
      deviceId: body.deviceId ?? '',
      apiKey: body.apiKey ?? '',
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return desktopApiError(error, 'Failed to create desktop usage session')
  }
}
