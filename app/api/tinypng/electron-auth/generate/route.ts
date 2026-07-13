import { NextResponse } from "next/server"

export const runtime = "edge"

export async function POST() {
  return NextResponse.json({
    error: '旧版 Electron 授权链接已停用，请由管理员重新生成桌面端授权链接。',
    code: 'LEGACY_AUTH_GONE',
  }, { status: 410 })
}
