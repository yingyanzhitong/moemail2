#!/usr/bin/env tsx
/**
 * TinyPNG API Key 自动生成器
 * 
 * 使用 MoeMail OpenAPI 生成临时邮箱，自动注册 TinyPNG 并获取 API Key
 * 
 * 使用方法:
 *   pnpm tsx scripts/tinypng-api-key-generator.ts
 * 
 * 环境变量:
 *   MOEMAIL_API_TOKEN - MoeMail API Token
 *   CUSTOM_DOMAIN - MoeMail 自定义域名 (可选，默认使用系统配置)
 */

import "dotenv/config"

// ==================== 配置 ====================

const MOEMAIL_API_TOKEN = process.env.MOEMAIL_API_TOKEN
const MOEMAIL_BASE_URL = process.env.CUSTOM_DOMAIN 
  ? `https://${process.env.CUSTOM_DOMAIN}` 
  : "https://moemail.tinypng-token.site"

// TinyPNG 相关
const TINYPNG_LOGIN_URL = "https://tinypng.com/login"
const TINYPNG_API_URL = "https://api.tinify.com/api"
const TINYPNG_SENDER_PATTERNS = ["noreply@tinypng.com", "noreply@tinify.com", "tinypng.com", "tinify.com"]

// 轮询配置
const EMAIL_POLL_INTERVAL = 3000 // 3秒
const EMAIL_POLL_TIMEOUT = 120000 // 120秒

// ==================== MoeMail API ====================

interface MoeMailConfig {
  emailDomains: string
}

interface MoeMailMessage {
  id: string
  from_address: string | null
  to_address: string | null
  subject: string
  content: string
  html: string | null
  received_at: number
}

async function moemailRequest<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  if (!MOEMAIL_API_TOKEN) {
    throw new Error("MOEMAIL_API_TOKEN 未设置")
  }
  const url = `${MOEMAIL_BASE_URL}${endpoint}`
  const response = await fetch(url, {
    ...options,
    headers: {
      "X-API-Key": MOEMAIL_API_TOKEN,
      "Content-Type": "application/json",
      ...options.headers,
    },
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`MoeMail API 请求失败: ${response.status} - ${text}`)
  }

  return response.json() as Promise<T>
}

async function getConfig(): Promise<MoeMailConfig> {
  return moemailRequest<MoeMailConfig>("/api/config")
}

async function generateEmail(name: string, domain: string): Promise<{ id: string; email: string }> {
  return moemailRequest<{ id: string; email: string }>("/api/emails/generate", {
    method: "POST",
    body: JSON.stringify({
      name,
      expiryTime: 86400000, // 24小时
      domain,
    }),
  })
}

async function getMessages(emailId: string): Promise<{ messages: MoeMailMessage[] }> {
  return moemailRequest<{ messages: MoeMailMessage[] }>(`/api/emails/${emailId}`)
}

// ==================== TinyPNG 相关 ====================

async function registerTinyPng(email: string): Promise<void> {
  console.log(`[TinyPNG] 发送注册请求: ${email}`)
  
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
  
  console.log("[TinyPNG] 注册请求已发送，等待邮件...")
}

function extractMagicLink(html: string): string | null {
  const patterns = [
    /https:\/\/tinypng\.com\/login\?token=[^"'\s<>]+/gi,
    /https:\/\/tinify\.com\/login\?token=[^"'\s<>]+/gi,
    /href=["'](https:\/\/tinypng\.com\/login\?token=[^"']+)["']/gi,
    /href=["'](https:\/\/tinify\.com\/login\?token=[^"']+)["']/gi,
  ]

  for (const pattern of patterns) {
    const matches = html.match(pattern)
    if (matches && matches.length > 0) {
      let link = matches[0]
      if (link.startsWith('href=')) {
        link = link.replace(/href=["']/, '').replace(/["']$/, '')
      }
      link = link.replace(/&amp;/g, '&')
      return link
    }
  }

  const textPattern = /(https:\/\/(?:tinypng|tinify)\.com\/login\?token=[^\s]+)/gi
  const textMatches = html.match(textPattern)
  if (textMatches && textMatches.length > 0) {
    return textMatches[0].replace(/&amp;/g, '&')
  }

  return null
}

function isFromTinyPng(fromAddress: string | null): boolean {
  if (!fromAddress) return false
  const lowerFrom = fromAddress.toLowerCase()
  return TINYPNG_SENDER_PATTERNS.some(pattern => lowerFrom.includes(pattern))
}

async function getBearerToken(magicLinkToken: string): Promise<string> {
  console.log("[TinyPNG] 获取 Bearer Token...")
  
  const loginUrl = `${TINYPNG_LOGIN_URL}?token=${encodeURIComponent(magicLinkToken)}&redirect=/dashboard/api`
  
  const response = await fetch(loginUrl, {
    method: "GET",
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
    },
    redirect: "manual",
  })

  const cookies = response.headers.get("set-cookie")
  if (!cookies) {
    throw new Error("未能获取 session cookie")
  }

  const sessMatch = cookies.match(/sess=([^;]+)/)
  if (!sessMatch) {
    throw new Error("未找到 sess cookie")
  }

  const sessValue = sessMatch[1]
  
  try {
    // Node.js 中使用 Buffer 进行 base64 解码
    const decoded = Buffer.from(sessValue, 'base64').toString('utf-8')
    const tokenMatch = decoded.match(/"token":"([^"]+)"/)
    if (!tokenMatch) {
      throw new Error("sess cookie 中未找到 token")
    }
    return tokenMatch[1]
  } catch (error) {
    throw new Error(`解析 sess cookie 失败: ${error}`)
  }
}

interface TinyPngApiKey {
  key: string
  enabled: boolean
  description?: string
}

async function getApiKeys(bearerToken: string): Promise<TinyPngApiKey[]> {
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

async function createApiKey(bearerToken: string, description: string = "MoeMail Generated"): Promise<string> {
  console.log("[TinyPNG] 创建新 API Key...")
  
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

async function getAndEnableApiKey(bearerToken: string): Promise<string> {
  const existingKeys = await getApiKeys(bearerToken)
  
  if (existingKeys.length > 0) {
    const key = existingKeys[0]
    console.log(`[TinyPNG] 发现已存在的 API Key: ${key.key}`)
    console.log(`[TinyPNG] API Key 状态: enabled=${key.enabled}`)
    // 直接返回 key，不需要单独启用（新创建的 key 默认已启用）
    return key.key
  }
  
  return await createApiKey(bearerToken)
}

// ==================== 主流程 ====================

async function waitForMagicLinkEmail(emailId: string, startTime: number): Promise<string> {
  const deadline = startTime + EMAIL_POLL_TIMEOUT
  let attempts = 0
  
  while (Date.now() < deadline) {
    attempts++
    console.log(`[邮件] 第 ${attempts} 次检查邮件...`)
    
    try {
      const { messages } = await getMessages(emailId)
      
      for (const msg of messages) {
        if (msg.received_at > startTime && isFromTinyPng(msg.from_address)) {
          console.log(`[邮件] 收到 TinyPNG 邮件: ${msg.subject}`)
          const content = msg.html || msg.content
          const magicLink = extractMagicLink(content)
          if (magicLink) {
            console.log(`[邮件] 提取到 Magic Link`)
            return magicLink
          }
        }
      }
    } catch (error) {
      console.log(`[邮件] 检查失败: ${error}`)
    }
    
    await new Promise(resolve => setTimeout(resolve, EMAIL_POLL_INTERVAL))
  }
  
  throw new Error(`等待 TinyPNG magic link 邮件超时（${EMAIL_POLL_TIMEOUT / 1000}秒）`)
}

async function main() {
  console.log("=".repeat(60))
  console.log("TinyPNG API Key 自动生成器")
  console.log("=".repeat(60))
  
  // 检查环境变量
  if (!MOEMAIL_API_TOKEN) {
    console.error("错误: 未设置 MOEMAIL_API_TOKEN 环境变量")
    process.exit(1)
  }
  
  console.log(`\n[配置] MoeMail API: ${MOEMAIL_BASE_URL}`)
  
  try {
    // 1. 获取 MoeMail 配置
    console.log("\n[Step 1] 获取 MoeMail 配置...")
    const config = await getConfig()
    const domains = config.emailDomains.split(',').map(d => d.trim())
    console.log(`[配置] 可用域名: ${domains.join(', ')}`)
    
    // 使用第一个域名
    const domain = domains[0]
    
    // 2. 生成临时邮箱
    console.log("\n[Step 2] 生成临时邮箱...")
    const emailName = `tinypng-${Date.now().toString(36)}`
    const { id: emailId, email: emailAddress } = await generateEmail(emailName, domain)
    console.log(`[邮箱] 已创建: ${emailAddress}`)
    console.log(`[邮箱] ID: ${emailId}`)
    
    const startTime = Date.now()
    
    // 3. 在 TinyPNG 注册
    console.log("\n[Step 3] 在 TinyPNG 注册...")
    await registerTinyPng(emailAddress)
    
    // 4. 等待并获取 magic link 邮件
    console.log("\n[Step 4] 等待 Magic Link 邮件...")
    const magicLink = await waitForMagicLinkEmail(emailId, startTime)
    
    // 5. 提取 token 并获取 Bearer Token
    console.log("\n[Step 5] 获取 Bearer Token...")
    const url = new URL(magicLink)
    const token = url.searchParams.get("token")
    if (!token) {
      throw new Error("Magic link 中未找到 token 参数")
    }
    const bearerToken = await getBearerToken(token)
    console.log(`[Token] Bearer Token 获取成功`)
    
    // 6. 获取并启用 API Key
    console.log("\n[Step 6] 获取 API Key...")
    const apiKey = await getAndEnableApiKey(bearerToken)
    
    // 输出结果
    console.log("\n" + "=".repeat(60))
    console.log("✅ 成功!")
    console.log("=".repeat(60))
    console.log(`临时邮箱: ${emailAddress}`)
    console.log(`TinyPNG API Key: ${apiKey}`)
    console.log("=".repeat(60))
    
    // 返回结果
    return {
      email: emailAddress,
      apiKey,
    }
  } catch (error) {
    console.error("\n❌ 生成失败:", error)
    process.exit(1)
  }
}

// 运行主程序
main()
