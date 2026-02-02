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
        const linkMatch = (parsedMessage.html || parsedMessage.text || '').match(/https:\/\/tinify\.com\/dashboard\/api\/[^"'\s<]+/)
        
        if (linkMatch) {
            const loginUrl = linkMatch[0]
            try {
                // 1. Visit Login Link (catch cookies)
                // Use redirect: 'manual' to catch the 302 and Set-Cookie
                const loginResp = await fetch(loginUrl, { 
                    redirect: 'manual',
                    headers: { 'User-Agent': 'Mozilla/5.0' }
                })
                const setCookie = loginResp.headers.get('set-cookie')
                
                if (setCookie) {
                    console.log(`Got session cookie for ${targetEmail.address}`)
                    // 2. Visit Dashboard
                    // Changing URL from .../dashboard/api to .../dashboard
                    const dashResp = await fetch('https://tinify.com/dashboard', {
                        headers: { 
                            'Cookie': setCookie,
                            'User-Agent': 'Mozilla/5.0'
                        }
                    })
                    const dashHtml = await dashResp.text()
                    
                    // 3. Extract Key (Looking for value="KEY")
                    const keyMatch = dashHtml.match(/value="([A-Za-z0-9]{32})"/)
                    if (keyMatch && keyMatch[1]) {
                        await db.update(tinypngKeyPool)
                            .set({ 
                                apiKey: keyMatch[1], 
                                status: 'active',
                                updatedAt: new Date()
                            })
                            .where(eq(tinypngKeyPool.id, poolKey.id))
                        console.log(`Successfully activated TinyPNG key for ${targetEmail.address}`)
                    } else {
                        console.error('Failed to parse API key from dashboard HTML')
                    }
                } else {
                    console.error('No Set-Cookie header found in login response')
                }
            } catch (err) {
                console.error('Error activating TinyPNG key:', err)
            }
        } else {
             console.log('No dashboard link found in email')
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