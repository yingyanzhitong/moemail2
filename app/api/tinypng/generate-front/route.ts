import { NextResponse } from "next/server"
import { createDb } from "@/lib/db"
import { tinypngKeys, emails } from "@/lib/schema"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import { ROLES, type Role } from "@/lib/permissions"
import { createTinyPngTempEmail, finishTinyPngProcess, GenerateStep } from "@/lib/tinypng"
import { getRegisterScripts } from "@/lib/tinypng-scripts"
import { TINYPNG_KEY_LIMITS } from "@/lib/tinypng-limits"
import { eq, sql, and, gte } from "drizzle-orm"

export const runtime = "edge"

function getTodayStart(): Date {
  const now = new Date()
  const beijingOffset = 8 * 60 * 60 * 1000
  const beijingTime = new Date(now.getTime() + beijingOffset)
  const todayBeijing = new Date(beijingTime.getFullYear(), beijingTime.getMonth(), beijingTime.getDate())
  return new Date(todayBeijing.getTime() - beijingOffset)
}

export async function POST(request: Request) {
  try {
    const userId = await getUserId()
    if (!userId) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 })
    }

    const userRole = await getUserRole(userId)
    if (!userRole || userRole === ROLES.CIVILIAN) {
      return NextResponse.json({ error: "您没有权限使用此功能" }, { status: 403 })
    }

    const db = createDb()
    const limitConfig = TINYPNG_KEY_LIMITS[userRole as Role]

    // Check limits
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

    const body = await request.json().catch(() => ({})) as { 
        action: 'init' | 'finish', 
        domain?: string,
        emailId?: string 
    }

    if (body.action === 'init') {
        const env = getRequestContext().env
        const domainString = await env.SITE_CONFIG.get("EMAIL_DOMAINS")
        const domains = domainString ? domainString.split(',').map((d: string) => d.trim()) : []
        
        if (domains.length === 0) {
          return NextResponse.json({ error: "系统未配置邮箱域名" }, { status: 500 })
        }
    
        const domain = body.domain && domains.includes(body.domain) ? body.domain : domains[0]
        
        const createdEmail = await createTinyPngTempEmail(db, userId, domain)
        const scripts = getRegisterScripts(createdEmail.address)
        
        return NextResponse.json({
            success: true,
            email: createdEmail.address,
            emailId: createdEmail.id,
            scripts
        })
    } else if (body.action === 'finish') {
        if (!body.emailId) {
            return NextResponse.json({ error: "缺少 emailId" }, { status: 400 })
        }

        // Verify email belongs to user
        const emailRecord = await db.select().from(emails).where(and(eq(emails.id, body.emailId), eq(emails.userId, userId))).get()
        if (!emailRecord) {
            return NextResponse.json({ error: "邮箱不存在或不属于您" }, { status: 404 })
        }

        const steps: { step: GenerateStep; success: boolean; message?: string }[] = []
        
        try {
            const apiKey = await finishTinyPngProcess(db, body.emailId, (step, success, message) => {
                steps.push({ step, success, message })
            })

            await db.insert(tinypngKeys).values({
                userId,
                apiKey,
                email: emailRecord.address,
            })

            return NextResponse.json({
                success: true,
                apiKey,
                email: emailRecord.address,
                steps
            })
        } catch (error) {
            const errorMsg = error instanceof Error ? error.message : "未知错误"
            return NextResponse.json({
                success: false,
                error: errorMsg,
                steps
            }, { status: 500 })
        }
    } else {
        return NextResponse.json({ error: "无效的 action" }, { status: 400 })
    }

  } catch (error) {
    console.error('[TinyPNG Front API] Error:', error)
    return NextResponse.json({ error: error instanceof Error ? error.message : "未知错误" }, { status: 500 })
  }
}
