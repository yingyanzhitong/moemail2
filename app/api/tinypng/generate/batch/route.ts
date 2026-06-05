import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { tinypngKeys } from "@/lib/schema"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES, type Role } from "@/lib/permissions"
import { generateTinyPngApiKeysBatch } from "@/lib/tinypng"
import {
  TINYPNG_DAILY_LIMIT_CONFIG_KEY,
  getTinyPngLimitConfigForRole,
  parseRoleTinyPngDailyLimits,
} from "@/lib/tinypng-limits"
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

/**
 * POST: 批量生成 TinyPNG API Key
 * 优化流程：先并行创建邮箱和注册，再逐个获取 API Key
 */
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

    const env = getRequestContext().env
    const tinypngDailyLimitsConfig = await env.SITE_CONFIG.get(TINYPNG_DAILY_LIMIT_CONFIG_KEY)
    const limitConfig = getTinyPngLimitConfigForRole(
      userRole as Role,
      parseRoleTinyPngDailyLimits(tinypngDailyLimitsConfig),
    )
    const db = createDb()

    // 解析请求参数
    const body = await request.json().catch(() => ({})) as { count?: number; domain?: string; expiresInHours?: number }
    const requestedCount = body.count || 1
    const expiresInHours = body.expiresInHours || 1

    // 验证请求数量
    if (requestedCount < 1) {
      return NextResponse.json(
        { error: "生成数量必须大于 0" },
        { status: 400 }
      )
    }

    // 检查每次请求数量限制
    if (limitConfig.perRequest > 0 && requestedCount > limitConfig.perRequest) {
      return NextResponse.json({
        error: `每次最多生成 ${limitConfig.perRequest} 个 API Key`,
        perRequestLimit: limitConfig.perRequest,
      }, { status: 400 })
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
      const remainingToday = limitConfig.perDay - todayCount
      
      if (remainingToday <= 0) {
        return NextResponse.json({
          error: `您今日已达到 TinyPNG API Key 生成上限 (${limitConfig.perDay} 个/天)`,
          todayCount,
          dailyLimit: limitConfig.perDay,
          perRequestLimit: limitConfig.perRequest,
        }, { status: 403 })
      }

      // 如果请求数量超过今日剩余额度，调整为剩余额度
      if (requestedCount > remainingToday) {
        return NextResponse.json({
          error: `今日剩余额度 ${remainingToday} 个，请求数量超出限制`,
          todayCount,
          dailyLimit: limitConfig.perDay,
          remainingToday,
        }, { status: 400 })
      }
    }

    // 获取可用的邮箱域名
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
    
    // 执行批量 TinyPNG API Key 生成流程
    const result = await generateTinyPngApiKeysBatch(db, userId, domain, requestedCount, expiresInHours)

    // 保存成功生成的 TinyPNG API Key 到数据库
    const successfulResults = result.results.filter(r => r.apiKey)
    for (const item of successfulResults) {
      await db.insert(tinypngKeys).values({
        userId,
        apiKey: item.apiKey!,
        email: item.email,
      })
    }

    return NextResponse.json({
      success: result.success,
      results: result.results,
      totalRequested: result.totalRequested,
      totalSuccess: result.totalSuccess,
      totalFailed: result.totalFailed,
      message: `批量生成完成: 成功 ${result.totalSuccess} 个, 失败 ${result.totalFailed} 个`,
    })
  } catch (error) {
    console.error('[TinyPNG Batch API] 批量生成失败:', error)
    
    const errorMessage = error instanceof Error ? error.message : "未知错误"
    
    return NextResponse.json(
      { 
        success: false,
        error: `批量生成 TinyPNG API Key 失败: ${errorMessage}`,
      },
      { status: 500 }
    )
  }
}
