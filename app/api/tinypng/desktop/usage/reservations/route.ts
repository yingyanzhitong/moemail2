import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { createUsageReservation } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = await request.json() as { count?: number }
    const result = await createUsageReservation(request, getRequestContext().env.DB, body.count ?? 0)
    return NextResponse.json(result, { status: 201, headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return desktopApiError(error, 'Failed to create usage reservation')
  }
}
