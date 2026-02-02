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
import { emails, messages, tinypngKeyPool } from "@/lib/schema"
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
 * 生成步骤枚举
 */
export enum GenerateStep {
  CREATE_EMAIL = "创建临时邮箱",
  REGISTER_TINYPNG = "注册 TinyPNG 账号",
  WAIT_MAGIC_LINK = "等待 magic link 邮件",
  EXTRACT_TOKEN = "提取 magic link token",
  GET_BEARER_TOKEN = "获取 Bearer Token",
  GET_API_KEY = "获取 API Key",
  FETCH_FROM_POOL = "从缓冲池获取",
}

/**
 * 生成结果接口
 */
export interface GenerateResult {
  success: boolean
  apiKey?: string
  email?: string
  steps: {
    step: GenerateStep
    success: boolean
    message?: string
    duration?: number
  }[]
  error?: {
    step: GenerateStep
    message: string
  }
}

/**
 * 生成 TinyPNG API Key 的完整流程
 * @param db 数据库实例
 * @param userId 用户 ID
 * @param domain 邮箱域名
 * @returns 包含详细步骤信息的生成结果
 */
/**
 * 创建 TinyPNG 专用临时邮箱
 */
export async function createTinyPngTempEmail(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  domain: string
): Promise<{ id: string; address: string }> {
  const emailAddress = `tinypng-${nanoid(8)}@${domain}`
  const now = new Date()
  const expiresAt = new Date(now.getTime() + 1 * 60 * 60 * 1000) // 1小时后过期

  const [result] = await db
    .insert(emails)
    .values({
      address: emailAddress,
      userId: userId,
      createdAt: now,
      expiresAt: expiresAt,
    })
    .returning()
  
  return result
}

/**
 * 完成 TinyPNG API Key 生成流程 (等待邮件 -> 获取Key)
 */
export async function finishTinyPngProcess(
  db: DrizzleD1Database<Record<string, unknown>>,
  emailId: string,
  onStep?: (step: GenerateStep, success: boolean, message?: string) => void
): Promise<string> {
  const now = new Date()
  
  // 3. 等待 magic link 邮件
  onStep?.(GenerateStep.WAIT_MAGIC_LINK, true, "开始等待邮件")
  console.log(`[TinyPNG] 等待 magic link 邮件...`)
  const magicLink = await waitForMagicLinkEmail(db, emailId, now)
  onStep?.(GenerateStep.WAIT_MAGIC_LINK, true, `收到 magic link`)
  console.log(`[TinyPNG] 收到 magic link: ${magicLink}`)
  
  // 4. 提取 token
  const token = extractTokenFromMagicLink(magicLink)
  onStep?.(GenerateStep.EXTRACT_TOKEN, true, "Token 提取成功")
  
  // 5. 获取 Bearer Token
  console.log(`[TinyPNG] 获取 Bearer Token...`)
  const bearerToken = await getBearerToken(token)
  onStep?.(GenerateStep.GET_BEARER_TOKEN, true, "Bearer Token 获取成功")
  
  // 6. 获取 API Key
  console.log(`[TinyPNG] 获取 API Key...`)
  const apiKey = await getAndEnableApiKey(bearerToken)
  onStep?.(GenerateStep.GET_API_KEY, true, `API Key: ${apiKey.substring(0, 8)}...`)
  console.log(`[TinyPNG] API Key 生成成功: ${apiKey.substring(0, 8)}...`)

  return apiKey
}

/**
 * 生成 TinyPNG API Key 的完整流程
 * @param db 数据库实例
 * @param userId 用户 ID
 * @param domain 邮箱域名
 * @returns 包含详细步骤信息的生成结果
 */
export async function generateTinyPngApiKey(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  domain: string
): Promise<GenerateResult> {
  const steps: GenerateResult['steps'] = []
  let currentStep: GenerateStep = GenerateStep.CREATE_EMAIL
  let stepStartTime = Date.now()
  
  const recordStep = (success: boolean, message?: string) => {
    // Only record if it's the current step result
    steps.push({
      step: currentStep,
      success,
      message,
      duration: Date.now() - stepStartTime,
    })
    stepStartTime = Date.now()
  }

  
  let createdEmail: { id: string; address: string } | undefined
  
  try {
    // 0. 尝试从缓冲池获取 (Check Pool first)
    try {
      // Find an active key from the pool
      const poolKey = await db.select().from(tinypngKeyPool)
        .where(eq(tinypngKeyPool.status, 'active'))
        .limit(1)
        .get()

      if (poolKey?.apiKey) {
         console.log(`[TinyPNG] Retrieving key from pool: ${poolKey.email}`)
         
         // Update associated email expiration to 1 hour
         const [emailRec] = await db.select().from(emails)
             .where(eq(emails.address, poolKey.email))
             .limit(1)
         
         if (emailRec) {
             const currentTime = new Date()
             await db.update(emails)
                 .set({ expiresAt: new Date(currentTime.getTime() + 60 * 60 * 1000) })
                 .where(eq(emails.id, emailRec.id))
         }
         
         // Mark as used instead of deleting, so we can track usage statistics
         await db.update(tinypngKeyPool)
             .set({ status: 'used', updatedAt: new Date() })
             .where(eq(tinypngKeyPool.id, poolKey.id))
         
         return {
             success: true,
             apiKey: poolKey.apiKey,
             email: poolKey.email,
             steps: [
                 { step: GenerateStep.FETCH_FROM_POOL, success: true, message: '从缓冲池获取成功', duration: 0 }
             ]
         }
      }
    } catch(poolErr) {
        console.error('[TinyPNG] Failed to check pool:', poolErr)
    }

    // 1. 生成临时邮箱
    currentStep = GenerateStep.CREATE_EMAIL
    try {
      createdEmail = await createTinyPngTempEmail(db, userId, domain)
      recordStep(true, `邮箱: ${createdEmail.address}`)
      console.log(`[TinyPNG] 创建临时邮箱: ${createdEmail.address}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      recordStep(false, errorMsg)
      throw error
    }
    
    // 2. 在 TinyPNG 注册
    currentStep = GenerateStep.REGISTER_TINYPNG
    console.log(`[TinyPNG] 发送注册请求...`)
    await registerTinyPng(createdEmail.address)
    recordStep(true, "注册请求已发送")
    
    // 3 - 6. 完成后续流程
    // 由于 finishTinyPngProcess 是为了复用，这里我们手动展开调用或者稍微修改 finishTinyPngProcess 以更好配合
    // 为了保持 generateTinyPngApiKey 的原有逻辑清晰，我们这里直接调用 finishTinyPngProcess
    // 但是我们需要能够捕获中间状态。
    // 实际上，generateTinyPngApiKey 的原有实现是线性的，我们这里重写它调用 finishTinyPngProcess
    
    // 我们在这里自定义 callback 来记录步骤
    // 注意：createTinyPngTempEmail 和 registerTinyPng 已经执行完了
    // finishTinyPngProcess 从 WAIT_MAGIC_LINK 开始
    
    currentStep = GenerateStep.WAIT_MAGIC_LINK
    const apiKey = await finishTinyPngProcess(db, createdEmail.id, (step, _success, message) => {
       if (step !== currentStep) {
         // 步骤变了，说明上一步成功了（finishTinyPngProcess 只有成功才继续）
         // 但是 finishTinyPngProcess 的 callback 并不是 createApiKey 那种 success/fail 模式，
         // 它是 "started" 或者 "finished" 的通知。
         // 让我们看 finishTinyPngProcess 的实现：
         // 它在每个阶段成功后调用 callback。
         // 所以我们可以记录上一个步骤的成功。
         recordStep(true, message) // 这里的 message 是上一步的成功消息
         currentStep = step // 更新为下一步（或者当前正在进行的步）
       } else {
         // 同一步骤的更新？finishTinyPngProcess 实现里每步调用一次 success
         recordStep(true, message)
       }
    })
    
    return {
      success: true,
      apiKey,
      email: createdEmail.address,
      steps,
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error)
    // 如果是 finishTinyPngProcess 抛出的错误，recordStep 可能还没调用
    // 需要判断是否需要记录当前步骤的失败
    if (steps.length === 0 || steps[steps.length - 1].step !== currentStep) {
        recordStep(false, errorMsg)
    }

    // 如果失败，删除创建的临时邮箱
    if (createdEmail) {
      try {
        await db.delete(emails).where(eq(emails.id, createdEmail.id))
      } catch (deleteError) {
        console.error('[TinyPNG] 删除临时邮箱失败:', deleteError)
      }
    }
    
    return {
      success: false,
      steps,
      error: {
        step: currentStep,
        message: errorMsg,
      }
    }
  }
}

/**
 * 批量生成结果接口
 */
export interface BatchGenerateResult {
  success: boolean
  results: {
    email: string
    apiKey?: string
    error?: string
  }[]
  totalRequested: number
  totalSuccess: number
  totalFailed: number
}

/**
 * 单个邮箱的准备状态
 */
interface PreparedEmail {
  id: string
  address: string
  registered: boolean
  error?: string
}

/**
 * 批量生成 TinyPNG API Key
 * 优化流程：先并行创建邮箱和注册，再逐个获取 API Key
 * @param db 数据库实例
 * @param userId 用户 ID
 * @param domain 邮箱域名
 * @param count 生成数量
 * @returns 批量生成结果
 */
export async function generateTinyPngApiKeysBatch(
  db: DrizzleD1Database<Record<string, unknown>>,
  userId: string,
  domain: string,
  count: number,
  expiresInHours: number = 1 // Default to 1 hour
): Promise<BatchGenerateResult> {
  const results: BatchGenerateResult['results'] = []
  const preparedEmails: PreparedEmail[] = []
  const now = new Date()
  const expiresAt = new Date(now.getTime() + expiresInHours * 60 * 60 * 1000)

  console.log(`[TinyPNG Batch] 开始批量生成 ${count} 个 API Key (有效期 ${expiresInHours} 小时)`)

  // 阶段0：尝试从缓冲池获取 Active 的账号
  console.log(`[TinyPNG Batch] 阶段0: 尝试从缓冲池获取 Active 账号...`)
  let neededCount = count
  
  try {
    const activeKeys = await db.select().from(tinypngKeyPool)
      .where(eq(tinypngKeyPool.status, 'active'))
      .limit(neededCount)
      .all()

    for (const poolKey of activeKeys) {
        if (poolKey.apiKey) {
             console.log(`[TinyPNG Batch] Retrieving key from pool: ${poolKey.email}`)
             
             // Update associated email expiration to requested hours
             const [emailRec] = await db.select().from(emails)
                 .where(eq(emails.address, poolKey.email))
                 .limit(1)
             
             if (emailRec) {
                 const currentTime = new Date()
                 await db.update(emails)
                     .set({ expiresAt: new Date(currentTime.getTime() + expiresInHours * 60 * 60 * 1000) })
                     .where(eq(emails.id, emailRec.id))
             }
             
             // Mark as used instead of deleting, so we can track usage statistics
             await db.update(tinypngKeyPool)
                 .set({ status: 'used', updatedAt: new Date() })
                 .where(eq(tinypngKeyPool.id, poolKey.id))
             
             results.push({
                email: poolKey.email,
                apiKey: poolKey.apiKey,
             })
             
             neededCount--
        }
    }
    console.log(`[TinyPNG Batch] 从缓冲池成功获取 ${count - neededCount} 个`)
  } catch (poolErr) {
    console.error('[TinyPNG Batch] Failed to check pool:', poolErr)
  }

  // 如果已经获取够了，直接返回
  if (neededCount <= 0) {
      console.log(`[TinyPNG Batch] 缓冲池已满足所有请求，直接完成`)
      return {
        success: true,
        results,
        totalRequested: count,
        totalSuccess: count,
        totalFailed: 0,
      }
  }

  // 阶段1：批量创建临时邮箱 (仅为剩余所需数量)
  console.log(`[TinyPNG Batch] 阶段1: 创建 ${neededCount} 个临时邮箱...`)
  for (let i = 0; i < neededCount; i++) {
    const emailAddress = `tinypng-${nanoid(8)}@${domain}`
    try {
      const [result] = await db
        .insert(emails)
        .values({
          address: emailAddress,
          userId: userId,
          createdAt: now,
          expiresAt: expiresAt,
        })
        .returning()
      
      preparedEmails.push({
        id: result.id,
        address: emailAddress,
        registered: false,
      })
      console.log(`[TinyPNG Batch] 创建邮箱 ${i + 1}/${neededCount}: ${emailAddress}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      console.error(`[TinyPNG Batch] 创建邮箱失败: ${errorMsg}`)
      results.push({
        email: emailAddress,
        error: `创建邮箱失败: ${errorMsg}`,
      })
    }
  }

  // 阶段2：并行向 TinyPNG 发送注册请求 (限制速率：2个/秒)
  console.log(`[TinyPNG Batch] 阶段2: 速率限制发送 ${preparedEmails.length} 个注册请求 (2个/秒)...`)
  
  for (let i = 0; i < preparedEmails.length; i += 2) {
    const chunk = preparedEmails.slice(i, i + 2)
    const promises = chunk.map(async (email, chunkIndex) => {
      const globalIndex = i + chunkIndex
      try {
        await registerTinyPng(email.address)
        email.registered = true
        console.log(`[TinyPNG Batch] 注册请求 ${globalIndex + 1}/${preparedEmails.length} 已发送: ${email.address}`)
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error)
        email.error = `注册失败: ${errorMsg}`
        console.error(`[TinyPNG Batch] 注册失败 ${email.address}: ${errorMsg}`)
      }
    })
    
    await Promise.all(promises)
    
    // 如果还有更多邮箱需要处理，等待 1 秒
    if (i + 2 < preparedEmails.length) {
      await new Promise(resolve => setTimeout(resolve, 1000))
    }
  }

  // 阶段3：逐个等待邮件并获取 API Key
  console.log(`[TinyPNG Batch] 阶段3: 逐个获取 API Key...`)
  const successfulEmails = preparedEmails.filter(e => e.registered && !e.error)
  
  for (let i = 0; i < successfulEmails.length; i++) {
    const email = successfulEmails[i]
    console.log(`[TinyPNG Batch] 处理 ${i + 1}/${successfulEmails.length}: ${email.address}`)
    
    try {
      // 等待 magic link 邮件
      const magicLink = await waitForMagicLinkEmail(db, email.id, now)
      console.log(`[TinyPNG Batch] 收到 magic link: ${email.address}`)
      
      // 提取 token
      const token = extractTokenFromMagicLink(magicLink)
      
      // 获取 Bearer Token
      const bearerToken = await getBearerToken(token)
      
      // 获取 API Key
      const apiKey = await getAndEnableApiKey(bearerToken)
      
      results.push({
        email: email.address,
        apiKey,
      })
      console.log(`[TinyPNG Batch] API Key 生成成功: ${email.address}`)
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      results.push({
        email: email.address,
        error: errorMsg,
      })
      console.error(`[TinyPNG Batch] 获取 API Key 失败 ${email.address}: ${errorMsg}`)
    }
  }

  // 添加注册失败的邮箱到结果
  const failedEmails = preparedEmails.filter(e => !e.registered || e.error)
  for (const email of failedEmails) {
    results.push({
      email: email.address,
      error: email.error || "注册未完成",
    })
  }

  const totalSuccess = results.filter(r => r.apiKey).length
  const totalFailed = results.filter(r => r.error).length

  console.log(`[TinyPNG Batch] 批量生成完成: 成功 ${totalSuccess}, 失败 ${totalFailed}`)

  return {
    success: totalSuccess > 0,
    results,
    totalRequested: count,
    totalSuccess,
    totalFailed,
  }
}
