import { getRequestContext } from '@cloudflare/next-on-pages'
import { NextResponse } from 'next/server'
import { desktopApiError } from '@/lib/desktop-license-http'
import { authenticateDesktopLicense, getDesktopLicenseView } from '@/lib/desktop-license-service'

export const runtime = 'edge'

export async function GET(request: Request) {
  try {
    const database = getRequestContext().env.DB
    const license = await authenticateDesktopLicense(request, database)
    return NextResponse.json(await getDesktopLicenseView(database, license.id), {
      headers: { 'Cache-Control': 'no-store' },
    })
  } catch (error) {
    return desktopApiError(error, 'Failed to get desktop license')
  }
}
