import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { completeUsageReservation } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const [{ id }, body] = await Promise.all([
      params,
      request.json() as Promise<{ successCount?: number }>,
    ])
    const result = await completeUsageReservation(
      request,
      getRequestContext().env.DB,
      id,
      body.successCount ?? -1,
    )
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return desktopApiError(error, 'Failed to complete usage reservation')
  }
}
