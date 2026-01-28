/**
 * TinyPNG API Key 自动生成服务
 * 
 * 完整流程：
 * 1. 使用临时邮箱在 TinyPNG 注册
 * 2. 监听 magic link 邮件
 * 3. 解析 magic link 获取 Bearer Token
 * 4. 使用 Bearer Token 获取并启用 API Key
 */

import { nanoid } from "nanoid"
import { emails, messages } from "@/lib/schema"
import { eq, and, gt, desc } from "drizzle-orm"
import type { DrizzleD1Database } from "drizzle-orm/d1"

// TinyPNG 相关常量
const TINYPNG_LOGIN_URL = "https://tinypng.com/login"
const TINYPNG_API_URL = "https://api.tinify.com/api"
const TINYPNG_SENDER_PATTERNS = ["noreply@tinypng.com", "noreply@tinify.com", "tinypng.com", "tinify.com"]

// 等待邮件的配置
const EMAIL_POLL_INTERVAL = 3000 // 3秒轮询一次
const EMAIL_POLL_TIMEOUT = 120000 // 120秒超时

/**
 * 在 TinyPNG 注册账号
 * @param email 邮箱地址
 */
export async function registerTinyPng(email: string): Promise<void> {
  const response = await fetch("https://tinify.com/web/api", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json, text/plain, */*",
      "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36",
      "Origin": "https://tinify.com",
      "Referer": "https://tinify.com/developers",
    },
    body: JSON.stringify({ 
      fullName: email,
      mail: email 
    }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`TinyPNG 注册失败: ${response.status} - ${text}`)
  }
}

/**
 * 从邮件 HTML 内容中提取 magic link
 * @param html 邮件 HTML 内容
 * @returns magic link URL 或 null
 */
export function extractMagicLink(html: string): string | null {
  // 匹配 TinyPNG magic link 格式
  // https://tinypng.com/login?token=xxx&new=true&redirect=/dashboard/api
  const patterns = [
    /https:\/\/tinypng\.com\/login\?token=[^"'\s<>]+/gi,
    /https:\/\/tinify\.com\/login\?token=[^"'\s<>]+/gi,
    /href=["'](https:\/\/tinypng\.com\/login\?token=[^"']+)["']/gi,
    /href=["'](https:\/\/tinify\.com\/login\?token=[^"']+)["']/gi,
  ]

  for (const pattern of patterns) {
    const matches = html.match(pattern)
    if (matches && matches.length > 0) {
      // 清理匹配结果
      let link = matches[0]
      // 如果是 href="..." 格式，提取 URL
      if (link.startsWith('href=')) {
        link = link.replace(/href=["']/, '').replace(/["']$/, '')
      }
      // 解码 HTML 实体
      link = link.replace(/&amp;/g, '&')
      return link
    }
  }

  // 也尝试从纯文本中匹配
  const textPattern = /(https:\/\/(?:tinypng|tinify)\.com\/login\?token=[^\s]+)/gi
  const textMatches = html.match(textPattern)
  if (textMatches && textMatches.length > 0) {
    return textMatches[0].replace(/&amp;/g, '&')
  }

  return null
}

/**
 * 从 magic link URL 中提取 token 参数
 * @param magicLink magic link URL
 * @returns token 字符串
 */
export function extractTokenFromMagicLink(magicLink: string): string {
  const url = new URL(magicLink)
  const token = url.searchParams.get("token")
  if (!token) {
    throw new Error("Magic link 中未找到 token 参数")
  }
  return token
}

/**
 * 通过 magic link token 获取 Bearer Token
 * @param magicLinkToken magic link 中的 token 参数
 * @returns Bearer Token
 */
export async function getBearerToken(magicLinkToken: string): Promise<string> {
  // 首先访问 magic link 获取 session cookie
  const loginUrl = `${TINYPNG_LOGIN_URL}?token=${encodeURIComponent(magicLinkToken)}&redirect=/dashboard/api`
  
  const response = await fetch(loginUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    },
    redirect: "manual", // 不自动跟随重定向，我们需要获取 cookie
  })

  // 获取 Set-Cookie header
  const cookies = response.headers.get("set-cookie")
  if (!cookies) {
    throw new Error("未能获取 session cookie")
  }

  // 提取 sess cookie
  const sessMatch = cookies.match(/sess=([^;]+)/)
  if (!sessMatch) {
    throw new Error("未找到 sess cookie")
  }

  const sessValue = sessMatch[1]
  
  // Base64 解码 sess cookie 获取 token
  try {
    const decoded = atob(sessValue)
    const tokenMatch = decoded.match(/"token":"([^"]+)"/)
    if (!tokenMatch) {
      throw new Error("sess cookie 中未找到 token")
    }
    return tokenMatch[1]
  } catch (error) {
    throw new Error(`解析 sess cookie 失败: ${error}`)
  }
}

/**
 * API Key 信息接口
 */
export interface TinyPngApiKey {
  key: string
  enabled: boolean
  description?: string
}

/**
 * 使用 Bearer Token 获取 API Keys 列表
 * @param bearerToken Bearer Token
 * @returns API Keys 列表
 */
export async function getApiKeys(bearerToken: string): Promise<TinyPngApiKey[]> {
  const response = await fetch(TINYPNG_API_URL, {
    method: "GET",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`获取 API Keys 失败: ${response.status} - ${text}`)
  }

  const data = await response.json() as { keys?: TinyPngApiKey[] }
  return data.keys || []
}

/**
 * 创建新的 API Key
 * @param bearerToken Bearer Token
 * @param description API Key 描述
 * @returns 新创建的 API Key
 */
export async function createApiKey(bearerToken: string, description: string = "MoeMail Generated"): Promise<string> {
  const response = await fetch(TINYPNG_API_URL, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${bearerToken}`,
      "Content-Type": "application/json",
      "Accept": "application/json",
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    },
    body: JSON.stringify({ description }),
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`创建 API Key 失败: ${response.status} - ${text}`)
  }

  const data = await response.json() as { key?: string }
  if (!data.key) {
    throw new Error("创建 API Key 响应中未找到 key")
  }
  
  return data.key
}

/**
 * 获取 API Key
 * 如果已有 API Key 则返回第一个，否则创建新的
 * 注意：TinyPNG 新创建的 API Key 默认已启用
 * @param bearerToken Bearer Token
 * @returns 可用的 API Key
 */
export async function getAndEnableApiKey(bearerToken: string): Promise<string> {
  // 先获取现有的 API Keys
  const existingKeys = await getApiKeys(bearerToken)
  
  if (existingKeys.length > 0) {
    // 如果有现有的 key，直接返回（默认已启用）
    return existingKeys[0].key
  }
  
  // 没有现有 key，创建新的
  const newKey = await createApiKey(bearerToken)
  return newKey
}

/**
 * 检查邮件是否来自 TinyPNG
 * @param fromAddress 发件人地址
 * @returns 是否来自 TinyPNG
 */
export function isFromTinyPng(fromAddress: string | null): boolean {
  if (!fromAddress) return false
  const lowerFrom = fromAddress.toLowerCase()
  return TINYPNG_SENDER_PATTERNS.some(pattern => lowerFrom.includes(pattern))
}

/**
 * 等待并获取 TinyPNG magic link 邮件
 * @param db 数据库实例
 * @param emailId 邮箱 ID
 * @param startTime 开始等待的时间
 * @returns magic link URL
 */
export async function waitForMagicLinkEmail(
  db: DrizzleD1Database<Record<string, unknown>>,
  emailId: string,
  startTime: Date
): Promise<string> {
  const deadline = startTime.getTime() + EMAIL_POLL_TIMEOUT
  
  while (Date.now() < deadline) {
    // 查询该邮箱收到的新邮件
    const newMessages = await db
      .select()
      .from(messages)
      .where(
        and(
          eq(messages.emailId, emailId),
          gt(messages.receivedAt, startTime)
        )
      )
      .orderBy(desc(messages.receivedAt))
    
    // 检查是否有来自 TinyPNG 的邮件
    for (const msg of newMessages) {
      if (isFromTinyPng(msg.fromAddress)) {
        // 尝试从 HTML 或纯文本内容中提取 magic link
        const content = msg.html || msg.content
        const magicLink = extractMagicLink(content)
        if (magicLink) {
          return magicLink
        }
      }
    }
    
    // 等待下一次轮询
    await new Promise(resolve => setTimeout(resolve, EMAIL_POLL_INTERVAL))
  }
  
  throw new Error(`等待 TinyPNG magic link 邮件超时（${EMAIL_POLL_TIMEOUT / 1000}秒）`)
}

/**
 * 生成 TinyPNG API Key 的完整流程
 * @param db 数据库实例
 * @param userId 用户 ID
 * @param domain 邮箱域名
 * @returns API Key 和使用的邮箱地址
 */
export async function generateTinyPngApiKey(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  domain: string
): Promise<{ apiKey: string; email: string }> {
  // 1. 生成临时邮箱
  const emailAddress = `tinypng-${nanoid(8)}@${domain}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000) // 24小时后过期
  
  const [createdEmail] = await db
    .insert(emails)
    .values({
      address: emailAddress,
      userId: userId,
      createdAt: now,
      expiresAt: expiresAt,
    })
    .returning()
  
  console.log(`[TinyPNG] 创建临时邮箱: ${emailAddress}`)
  
  try {
    // 2. 在 TinyPNG 注册
    console.log(`[TinyPNG] 发送注册请求...`)
    await registerTinyPng(emailAddress)
    
    // 3. 等待 magic link 邮件
    console.log(`[TinyPNG] 等待 magic link 邮件...`)
    const magicLink = await waitForMagicLinkEmail(db, createdEmail.id, now)
    console.log(`[TinyPNG] 收到 magic link: ${magicLink}`)
    
    // 4. 提取 token 并获取 Bearer Token
    const token = extractTokenFromMagicLink(magicLink)
    console.log(`[TinyPNG] 获取 Bearer Token...`)
    const bearerToken = await getBearerToken(token)
    
    // 5. 获取并启用 API Key
    console.log(`[TinyPNG] 获取并启用 API Key...`)
    const apiKey = await getAndEnableApiKey(bearerToken)
    console.log(`[TinyPNG] API Key 生成成功: ${apiKey.substring(0, 8)}...`)
    
    return {
      apiKey,
      email: emailAddress,
    }
  } catch (error) {
    // 如果失败，删除创建的临时邮箱
    await db.delete(emails).where(eq(emails.id, createdEmail.id))
    throw error
  }
}
