import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { tinypngKeys } from "@/lib/schema"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES, type Role } from "@/lib/permissions"
import { generateTinyPngApiKey } from "@/lib/tinypng"
import { TINYPNG_KEY_LIMITS } from "@/lib/tinypng-limits"
import { eq, sql, and, gte } from "drizzle-orm"

export const runtime = "edge"

/**
 * 获取今日开始时间（UTC+8）
 */
function getTodayStart(): Date {
  const now = new Date()
  // 转换为北京时间
  const beijingOffset = 8 * 60 * 60 * 1000
  const beijingTime = new Date(now.getTime() + beijingOffset)
  // 获取北京时间今天 00:00
  const todayBeijing = new Date(beijingTime.getFullYear(), beijingTime.getMonth(), beijingTime.getDate())
  // 转换回 UTC
  return new Date(todayBeijing.getTime() - beijingOffset)
}

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

    const db = createDb()
    const limitConfig = TINYPNG_KEY_LIMITS[userRole as Role]

    // 先检查用户是否已有存储的 TinyPNG API Key
    const existingKeys = await db.query.tinypngKeys.findMany({
      where: eq(tinypngKeys.userId, userId),
      orderBy: (keys, { desc }) => [desc(keys.createdAt)],
    })

    // 如果已有 key，直接返回最新的一个
    if (existingKeys.length > 0) {
      const latestKey = existingKeys[0]
      return NextResponse.json({
        success: true,
        apiKey: latestKey.apiKey,
        email: latestKey.email,
        message: "已有 TinyPNG API Key，无需重新生成",
        isExisting: true,
        totalKeys: existingKeys.length,
      })
    }

    // 检查每日生成限制
    if (limitConfig.perDay > 0) {
      const todayStart = getTodayStart()
      const [todayCountResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(tinypngKeys)
        .where(
          and(
            eq(tinypngKeys.userId, userId),
            gte(tinypngKeys.createdAt, todayStart)
          )
        )
      
      const todayCount = Number(todayCountResult.count)
      if (todayCount >= limitConfig.perDay) {
        return NextResponse.json({
          error: `您今日已达到 TinyPNG API Key 生成上限 (${limitConfig.perDay} 个/天)`,
          todayCount,
          dailyLimit: limitConfig.perDay,
          perRequestLimit: limitConfig.perRequest,
        }, { status: 403 })
      }
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
