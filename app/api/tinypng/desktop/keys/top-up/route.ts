import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { topUpDesktopKeys } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    return NextResponse.json(await topUpDesktopKeys(request, getRequestContext().env.DB), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return desktopApiError(error, 'Failed to top up desktop keys')
  }
}
