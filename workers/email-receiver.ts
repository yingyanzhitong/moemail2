import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { messages, emails, webhooks, tinypngKeyPool } from '../app/lib/schema'
import { eq, sql } from 'drizzle-orm'
import PostalMime from 'postal-mime'
import { WEBHOOK_CONFIG } from '../app/config/webhook'
import { EmailMessage } from '../app/lib/webhook'

const handleEmail = async (message: ForwardableEmailMessage, env: Env) => {
  const db = drizzle(env.DB, { schema: { messages, emails, webhooks, tinypngKeyPool } })

  const parsedMessage = await PostalMime.parse(message.raw)

  console.log("parsedMessage:", parsedMessage)

  try {
    const targetEmail = await db.query.emails.findFirst({
      where: eq(sql`LOWER(${emails.address})`, message.to.toLowerCase())
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

    // Only trigger webhook if the email belongs to a user
    if (targetEmail.userId) {
      const webhook = await db.query.webhooks.findFirst({
        where: eq(webhooks.userId, targetEmail.userId)
      })

      if (webhook?.enabled) {
        try {
          await fetch(webhook.url, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'X-Webhook-Event': WEBHOOK_CONFIG.EVENTS.NEW_MESSAGE
            },
            body: JSON.stringify({
              emailId: targetEmail.id,
              messageId: savedMessage.id,
              fromAddress: savedMessage.fromAddress,
              subject: savedMessage.subject,
              content: savedMessage.content,
              html: savedMessage.html,
              receivedAt: savedMessage.receivedAt.toISOString(),
              toAddress: targetEmail.address
            } as EmailMessage)
          })
        } catch (error) {
          console.error('Failed to send webhook:', error)
        }
      }
    }

    // Check for TinyPNG pool key extraction
    // We already have targetEmail, check if it's in our pool
    const poolKey = await db.query.tinypngKeyPool.findFirst({
        where: eq(tinypngKeyPool.email, targetEmail.address)
    })

    if (poolKey && poolKey.status === 'pending' && (message.from.includes('tinypng.com') || message.from.includes('tinify.com'))) {
        console.log(`Attempting to extract TinyPNG key for ${targetEmail.address}`)
        
        // Logic adapted from app/lib/tinypng.ts
        const content = parsedMessage.html || parsedMessage.text || ''
        
        // 1. Extract Magic Link
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
                link = link.replace(/&amp;/g, '&')
                magicLink = link
                break
            }
        }

        if (magicLink) {
            try {
                // 2. Extract Token
                const url = new URL(magicLink)
                const token = url.searchParams.get("token")
                
                if (token) {
                    // 3. Get Bearer Token via Login
                    const loginUrl = `https://tinypng.com/login?token=${encodeURIComponent(token)}&redirect=/dashboard/api`
                    const loginResp = await fetch(loginUrl, { 
                        method: "GET",
                        headers: {
                            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                        },
                        redirect: 'manual' 
                    })
                    const setCookie = loginResp.headers.get('set-cookie')
                    
                    if (setCookie) {
                        const sessMatch = setCookie.match(/sess=([^;]+)/)
                        if (sessMatch) {
                            const sessValue = sessMatch[1]
                            const decoded = atob(sessValue)
                            const tokenMatch = decoded.match(/"token":"([^"]+)"/)
                            
                            if (tokenMatch) {
                                const bearerToken = tokenMatch[1]
                                console.log(`Got Bearer Token for ${targetEmail.address}`)

                                // 4. Get/Create API Key
                                // First check existing
                                let finalApiKey = ''
                                
                                const listResp = await fetch("https://api.tinify.com/api", {
                                    headers: {
                                        "Authorization": `Bearer ${bearerToken}`,
                                        "Accept": "application/json",
                                        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                                    }
                                })
                                
                                if (listResp.ok) {
                                    const listData = await listResp.json() as { keys?: { key: string, enabled: boolean }[] }
                                    if (listData.keys && listData.keys.length > 0) {
                                        finalApiKey = listData.keys[0].key
                                    } else {
                                        // Create new key
                                        const createResp = await fetch("https://api.tinify.com/api", {
                                            method: "POST",
                                            headers: {
                                                "Authorization": `Bearer ${bearerToken}`,
                                                "Content-Type": "application/json",
                                                "Accept": "application/json",
                                                "User-Agent": "Mozilla/5.0"
                                            },
                                            body: JSON.stringify({ description: "Moemail Pool" })
                                        })
                                        if (createResp.ok) {
                                            const createData = await createResp.json() as { key: string }
                                            finalApiKey = createData.key
                                        }
                                    }
                                }

                                if (finalApiKey) {
                                    await db.update(tinypngKeyPool)
                                        .set({ 
                                            apiKey: finalApiKey, 
                                            status: 'active',
                                            updatedAt: new Date()
                                        })
                                        .where(eq(tinypngKeyPool.id, poolKey.id))
                                    console.log(`Successfully activated TinyPNG key for ${targetEmail.address}`)
                                } else {
                                    console.error('Failed to retrieve or create API key')
                                }

                            } else {
                                console.error('Token not found in sess cookie')
                            }
                        } else {
                            console.error('sess cookie not found')
                        }
                    } else {
                        console.error('No Set-Cookie header in login response')
                    }
                } else {
                    console.error('Token param not found in magic link')
                }
            } catch (err) {
                console.error('Error processing TinyPNG magic link:', err)
            }
        } else {
             console.log('No magic link found in email')
        }
    }

  } catch (error) {
    console.error('Failed to process email:', error)
  }
}

const worker = {
  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    await handleEmail(message, env)
  }
}

export default worker 