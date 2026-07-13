import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { messages, emails, webhooks, tinypngKeyPool } from '../app/lib/schema'
import { eq, sql } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { WEBHOOK_CONFIG } from '../app/config/webhook'
import { EmailMessage } from '../app/lib/webhook'
import {
  appendTinyPngTaskRunLog,
  formatTinyPngTaskLog,
} from '../app/lib/tinypng-pool-task-log'

const handleEmail = async (message: ForwardableEmailMessage, env: Env) => {
  const db = drizzle(env.DB, { schema: { messages, emails, webhooks, tinypngKeyPool } })
  const parsedMessage = await PostalMime.parse(message.raw)

  console.log('parsedMessage:', parsedMessage)

  try {
    const targetEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, message.to.toLowerCase()),
    })

    if (!targetEmail) {
      console.error(`Email not found: ${message.to}`)
      return
    }

    const savedMessage = await db.insert(messages).values({
      emailId: targetEmail.id,
      fromAddress: message.from,
      subject: parsedMessage.subject || '(无主题)',
      content: parsedMessage.text || '',
      html: parsedMessage.html || '',
      type: 'received',
    }).returning().get()

    if (targetEmail.userId) {
      const webhook = await db.query.webhooks.findFirst({
        where: eq(webhooks.userId, targetEmail.userId),
      })

      if (webhook?.enabled) {
        try {
          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Event': WEBHOOK_CONFIG.EVENTS.NEW_MESSAGE,
            },
            body: JSON.stringify({
              emailId: targetEmail.id,
              messageId: savedMessage.id,
              fromAddress: savedMessage.fromAddress,
              subject: savedMessage.subject,
              content: savedMessage.content,
              html: savedMessage.html,
              receivedAt: savedMessage.receivedAt.toISOString(),
              toAddress: targetEmail.address,
            } as EmailMessage),
          })
        } catch (error) {
          console.error('Failed to send webhook:', error)
        }
      }
    }

    const poolKey = await db.query.tinypngKeyPool.findFirst({
      where: eq(tinypngKeyPool.email, targetEmail.address),
    })
    const sender = message.from || ''

    if (!poolKey || !['pending', 'registered'].includes(poolKey.status) || (!sender.includes('tinypng.com') && !sender.includes('tinify.com'))) {
      return
    }

    console.log(`Attempting to extract TinyPNG key for ${targetEmail.address}`)

    const appendLog = async (details: string) => {
      try {
        await appendTinyPngTaskRunLog(
          env.DB,
          poolKey.taskRunId,
          formatTinyPngTaskLog(`邮箱：${targetEmail.address}\n${details}`),
        )
      } catch (error) {
        console.error('Failed to append TinyPNG pool process log:', error)
      }
    }

    const markFailed = async (step: string, details: string) => {
      const errorMessage = `${step}：${details}`
      await appendLog(`${step} 失败\n${details}`)
      await db.update(tinypngKeyPool)
        .set({
          status: 'registration_failed',
          errorMessage,
          updatedAt: new Date(),
        })
        .where(eq(tinypngKeyPool.id, poolKey.id))
    }

    await appendLog(`步骤 3/6：收到 TinyPNG 验证邮件\n发件人：${sender}\n主题：${parsedMessage.subject || '(无主题)'}`)

    const content = parsedMessage.html || parsedMessage.text || ''
    let magicLink: string | null = null
    const patterns = [
      /https:\/\/tinypng\.com\/login\?token=[^"'\s<>]+/gi,
      /https:\/\/tinify\.com\/login\?token=[^"'\s<>]+/gi,
      /href=["'](https:\/\/tinypng\.com\/login\?token=[^"']+)["']/gi,
      /href=["'](https:\/\/tinify\.com\/login\?token=[^"']+)["']/gi,
    ]

    for (const pattern of patterns) {
      const matches = content.match(pattern)
      if (matches && matches.length > 0) {
        let link = matches[0]
        if (link.startsWith('href=')) {
          link = link.replace(/href=["']/, '').replace(/["']$/, '')
        }
        magicLink = link.replace(/&amp;/g, '&')
        break
      }
    }

    if (!magicLink) {
      await markFailed('步骤 3/6：解析 Magic Link', '验证邮件中未找到 TinyPNG 登录链接。')
      return
    }

    await db.update(tinypngKeyPool)
      .set({ status: 'link_received', updatedAt: new Date() })
      .where(eq(tinypngKeyPool.id, poolKey.id))
    await appendLog('步骤 3/6 完成：Magic Link 已解析（链接已脱敏）。')

    try {
      const token = new URL(magicLink).searchParams.get('token')
      if (!token) {
        await markFailed('步骤 4/6：提取 Magic Link Token', '链接中未找到 token 参数。')
        return
      }
      await appendLog('步骤 4/6 完成：Magic Link Token 已提取（内容已脱敏）。')

      await appendLog('步骤 5/6：请求 TinyPNG 登录会话。')
      const loginUrl = `https://tinypng.com/login?token=${encodeURIComponent(token)}&redirect=/dashboard/api`
      const loginResp = await fetch(loginUrl, {
        method: 'GET',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        },
        redirect: 'manual',
      })
      const setCookie = loginResp.headers.get('set-cookie')
      await appendLog(`步骤 5/6：登录会话响应\nHTTP ${loginResp.status} ${loginResp.statusText}`)

      if (!setCookie) {
        await markFailed('步骤 5/6：获取登录会话', '响应中未返回 session cookie。')
        return
      }

      const sessMatch = setCookie.match(/sess=([^;]+)/)
      if (!sessMatch) {
        await markFailed('步骤 5/6：解析登录会话', 'session cookie 中未找到 sess 字段。')
        return
      }

      const decoded = atob(sessMatch[1])
      const tokenMatch = decoded.match(/"token":"([^"]+)"/)
      if (!tokenMatch) {
        await markFailed('步骤 5/6：解析 Bearer Token', 'session cookie 中未找到 Bearer Token。')
        return
      }
      const bearerToken = tokenMatch[1]
      await appendLog('步骤 5/6 完成：Bearer Token 已获取（内容已脱敏）。')

      await appendLog('步骤 6/6：查询 TinyPNG API Key。')
      const listResp = await fetch('https://api.tinify.com/api', {
        headers: {
          'Authorization': `Bearer ${bearerToken}`,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      })
      await appendLog(`步骤 6/6：API Key 查询响应\nHTTP ${listResp.status} ${listResp.statusText}`)

      if (!listResp.ok) {
        const details = await listResp.text()
        await markFailed('步骤 6/6：查询 API Key', details || 'TinyPNG 未返回可用 API Key。')
        return
      }

      const listData = await listResp.json() as { keys?: { key: string, enabled: boolean }[] }
      let finalApiKey = listData.keys?.[0]?.key || ''

      if (!finalApiKey) {
        await appendLog('步骤 6/6：未找到现有 API Key，开始创建新 Key。')
        const createResp = await fetch('https://api.tinify.com/api', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${bearerToken}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'User-Agent': 'Mozilla/5.0',
          },
          body: JSON.stringify({ description: 'Moemail Pool' }),
        })
        await appendLog(`步骤 6/6：创建 API Key 响应\nHTTP ${createResp.status} ${createResp.statusText}`)

        if (!createResp.ok) {
          const details = await createResp.text()
          await markFailed('步骤 6/6：创建 API Key', details || 'TinyPNG 未返回新 API Key。')
          return
        }

        const createData = await createResp.json() as { key?: string }
        finalApiKey = createData.key || ''
      }

      if (!finalApiKey) {
        await markFailed('步骤 6/6：保存 API Key', '响应中未包含 API Key。')
        return
      }

      await db.update(tinypngKeyPool)
        .set({
          apiKey: finalApiKey,
          status: 'active',
          errorMessage: null,
          updatedAt: new Date(),
        })
        .where(eq(tinypngKeyPool.id, poolKey.id))
      await appendLog('步骤 6/6 完成：API Key 已获取并入池，状态为 active（Key 已脱敏）。')
      console.log(`Successfully activated TinyPNG key for ${targetEmail.address}`)
    } catch (error) {
      const details = error instanceof Error ? error.message : String(error)
      await markFailed('步骤 4-6：处理 TinyPNG 登录与 API Key', details)
      console.error('Error processing TinyPNG magic link:', error)
    }
  } catch (error) {
    console.error('Failed to process email:', error)
  }
}

const worker = {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env)
  },
}

export default worker
