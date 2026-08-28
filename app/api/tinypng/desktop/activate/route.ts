import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { activatePendingDesktopLicense } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const result = await activatePendingDesktopLicense(request, getRequestContext().env.DB)
    return NextResponse.json(result, {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return desktopApiError(error, 'Failed to activate pending desktop license')
  }
}
