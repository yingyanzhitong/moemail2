import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { reportDesktopUsage } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function POST(request: Request) {
  try {
    const body = await request.json() as {
      reportId?: string
      requestedCount?: number
      successCount?: number
      periodStartsAt?: string
    }
    const result = await reportDesktopUsage(request, getRequestContext().env.DB, {
      reportId: body.reportId ?? '',
      requestedCount: body.requestedCount ?? 0,
      successCount: body.successCount ?? -1,
      periodStartsAt: body.periodStartsAt ?? '',
    })
    return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } })
  } catch (error) {
    return desktopApiError(error, 'Failed to report desktop usage')
  }
}
