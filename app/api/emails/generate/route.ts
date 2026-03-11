import { NextResponse } from "next/server"
import { nanoid } from "nanoid"
import { createDb } from "@/lib/db"
import { emails } from "@/lib/schema"
import { eq, and, gt, sql } from "drizzle-orm"
import { EXPIRY_OPTIONS } from "@/types/email"
import { getRequestContext } from "@cloudflare/next-on-pages"
import { getUserId } from "@/lib/apiKey"
import { getUserRole } from "@/lib/auth"
import {
  EMAIL_ROLE_LIMIT_CONFIG_KEY,
  getMaxEmailsForRole,
  isUnlimitedEmailLimit,
  parseRoleMaxEmails,
} from "@/lib/email-limits"

export const runtime = "edge"

export async function POST(request: Request) {
  const db = createDb()
  const env = getRequestContext().env

  const userId = await getUserId()
  const userRole = await getUserRole(userId!)

  try {
    // 统一获取配置，避免不同角色路径导致的 KV 访问问题
    const [domainString, roleMaxEmails, legacyMaxEmails] = await Promise.all([
      env.SITE_CONFIG.get("EMAIL_DOMAINS"),
      env.SITE_CONFIG.get(EMAIL_ROLE_LIMIT_CONFIG_KEY),
      env.SITE_CONFIG.get("MAX_EMAILS"),
    ])
    
    const domains = domainString 
      ? domainString.split(',') 
      : [process.env.DEFAULT_EMAIL_DOMAIN!]

    const resolvedRoleMaxEmails = parseRoleMaxEmails(roleMaxEmails, legacyMaxEmails)
    const maxEmailsValue = getMaxEmailsForRole(userRole, resolvedRoleMaxEmails, Number(legacyMaxEmails))

    if (!isUnlimitedEmailLimit(maxEmailsValue)) {
      const activeEmailsCount = await db
        .select({ count: sql<number>`count(*)` })
        .from(emails)
        .where(
          and(
            eq(emails.userId, userId!),
            gt(emails.expiresAt, new Date())
          )
        )
      
      if (Number(activeEmailsCount[0].count) >= Number(maxEmailsValue)) {
        return NextResponse.json(
          { error: `已达到最大邮箱数量限制 (${maxEmailsValue})` },
          { status: 403 }
        )
      }
    }

    const { name, expiryTime, domain } = await request.json<{ 
      name: string
      expiryTime: number
      domain: string
    }>()

    if (!EXPIRY_OPTIONS.some(option => option.value === expiryTime)) {
      return NextResponse.json(
        { error: "无效的过期时间" },
        { status: 400 }
      )
    }

    if (!domains || !domains.includes(domain)) {
      return NextResponse.json(
        { error: "无效的域名" },
        { status: 400 }
      )
    }

    const address = `${name || nanoid(8)}@${domain}`
    const existingEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, address.toLowerCase())
    })

    if (existingEmail) {
      return NextResponse.json(
        { error: "该邮箱地址已被使用" },
        { status: 409 }
      )
    }

    const now = new Date()
    const expires = expiryTime === 0 
      ? new Date('9999-01-01T00:00:00.000Z')
      : new Date(now.getTime() + expiryTime)
    
    const emailData: typeof emails.$inferInsert = {
      address,
      createdAt: now,
      expiresAt: expires,
      userId: userId!
    }
    
    const result = await db.insert(emails)
      .values(emailData)
      .returning({ id: emails.id, address: emails.address })
    
    return NextResponse.json({ 
      id: result[0].id,
      email: result[0].address 
    })
  } catch (error) {
    console.error('Failed to generate email:', error)
    return NextResponse.json(
      { error: "创建邮箱失败" },
      { status: 500 }
    )
  }
} 
