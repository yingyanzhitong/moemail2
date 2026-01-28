import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { tinypngKeys } from "@/lib/schema"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES } from "@/lib/permissions"
import { generateTinyPngApiKey } from "@/lib/tinypng"

export const runtime = "edge"

export async function POST(request: Request) {
  try {
    // 验证用户登录
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json(
        { error: "请先登录" },
        { status: 401 }
      )
    }

    // 验证用户权限 - 需要至少 Knight 级别
    const userRole = await getUserRole(userId)
    if (!userRole || userRole === ROLES.CIVILIAN) {
      return NextResponse.json(
        { error: "您没有权限使用此功能" },
        { status: 403 }
      )
    }

    // 解析请求参数
    const body = await request.json().catch(() => ({})) as { domain?: string }
    
    // 获取可用的邮箱域名
    const env = getRequestContext().env
    const domainString = await env.SITE_CONFIG.get("EMAIL_DOMAINS")
    const domains = domainString ? domainString.split(',').map((d: string) => d.trim()) : []
    
    if (domains.length === 0) {
      return NextResponse.json(
        { error: "系统未配置邮箱域名" },
        { status: 500 }
      )
    }

    // 使用请求中的域名或默认使用第一个
    const domain = body.domain && domains.includes(body.domain) ? body.domain : domains[0]
    
    // 执行 TinyPNG API Key 生成流程
    const db = createDb()
    const result = await generateTinyPngApiKey(db, userId, domain)

    // 检查生成结果
    if (!result.success || !result.apiKey || !result.email) {
      // 生成失败，返回详细的步骤信息
      return NextResponse.json({
        success: false,
        error: result.error ? `${result.error.step}: ${result.error.message}` : "生成失败",
        failedStep: result.error?.step,
        failedMessage: result.error?.message,
        steps: result.steps,
      }, { status: 500 })
    }

    // 保存生成的 TinyPNG API Key 到数据库
    await db.insert(tinypngKeys).values({
      userId,
      apiKey: result.apiKey,
      email: result.email,
    })

    return NextResponse.json({
      success: true,
      apiKey: result.apiKey,
      email: result.email,
      message: "TinyPNG API Key 生成成功",
      steps: result.steps,
    })
  } catch (error) {
    console.error('[TinyPNG API] 生成失败:', error)
    
    const errorMessage = error instanceof Error ? error.message : "未知错误"
    
    return NextResponse.json(
      { 
        success: false,
        error: `生成 TinyPNG API Key 失败: ${errorMessage}`,
        failedStep: "未知步骤",
        failedMessage: errorMessage,
      },
      { status: 500 }
    )
  }
}
