import { NextResponse } from 'next/server'
import { DesktopLicenseError } from '@/lib/desktop-license-service'

export function desktopApiError(error: unknown, context: string): NextResponse {
  if (error instanceof DesktopLicenseError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status })
  }

  console.error(context, error)
  return NextResponse.json({ error: '服务暂时不可用', code: 'INTERNAL_ERROR' }, { status: 500 })
}
