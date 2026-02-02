import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { emails, tinypngKeyPool } from '../app/lib/schema'
import { count, eq, inArray } from 'drizzle-orm'

// Configuration
const POOL_LIMIT = 500
const BATCH_SIZE = 10

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    const db = drizzle(env.DB, { schema: { emails, tinypngKeyPool } })
    
      // Check pool size
      // We count all keys that are in progress or active to respect the limit
      const poolCountResult = await db.select({ value: count() })
        .from(tinypngKeyPool)
        .where(inArray(tinypngKeyPool.status, ['pending', 'registered', 'link_received', 'active']))
        .get()
        
      const currentSize = poolCountResult?.value ?? 0
      
      if (currentSize >= POOL_LIMIT) {
        console.log(`Pool is full (${currentSize}/${POOL_LIMIT}). Skipping generation.`)
        return
      }
      
      // Use configured domain or fallback
      // Note: Env vars must be set in wrangler.tinypng.json or dashboard
      const domain = (env as any).EMAIL_DOMAIN || 'tinypng-token.site'
      console.log(`Generating ${BATCH_SIZE} emails for domain: ${domain}`)

      for (let i = 0; i < BATCH_SIZE; i++) {
        // Skip loop if we hit limit (checked initially, but good practice if batch is large)
        
        const randomId = crypto.randomUUID().split('-')[0]
        const emailAddress = `tiny_${randomId}@${domain}`
        
        // 1. Insert into Emails table (required for receiving)
        // We set a long expiry initially. It will be shortened when the key is dispensed.
        await db.insert(emails).values({
          id: crypto.randomUUID(),
          address: emailAddress,
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 365), // 365 days (effectively permanent until claimed)
          createdAt: new Date(),
        })
        
        // 2. Insert into Tinypng Pool - Status: pending (email created)
        await db.insert(tinypngKeyPool).values({
          email: emailAddress,
          status: 'pending'
        })
        
        // 3. Request Key from TinyPNG
        try {
            const response = await fetch('https://tinify.com/web/api', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'Origin': 'https://tinify.com',
                'Referer': 'https://tinify.com/developers',
              },
              body: JSON.stringify({ 
                  fullName: emailAddress,
                  mail: emailAddress 
              })
            })
            
            if (!response.ok) {
                const text = await response.text()
                console.error(`Failed to request key for ${emailAddress}: ${response.status} - ${text}`)
                // Stay in pending status to retry later? Or mark as failed? 
                // For now, if failed, we leave it as pending or we could delete it.
                // But as per user request: "pending not deleted... ip limit... retry next cycle"
                // So we do nothing, leaving it as 'pending'.
                // Ideally we should track 'attempts' or 'last_attempt_at' but schema changes might be too much right now.
                // We will rely on the fact that next time we might try to pick up pending ones?
                // Actually, this loop CREATES NEW emails. It doesn't retry old ones.
                // To support "retry using this email", we would need a separate logic to iterate existing 'pending' emails.
                // Let's add that logic below or mix it.
            } else {
               console.log(`Requested key for ${emailAddress}`)
               // Update status to 'registered'
               await db.update(tinypngKeyPool)
                 .set({ status: 'registered', updatedAt: new Date() })
                 .where(eq(tinypngKeyPool.email, emailAddress))
            }
        } catch (reqErr) {
            console.error(`Network error requesting key for ${emailAddress}`, reqErr)
        }
      }
      
      // 4. Retry Logic: Check 'pending' items and try to register them again
      // Fetch some pending items
      const pendingItems = await db.select().from(tinypngKeyPool)
        .where(eq(tinypngKeyPool.status, 'pending'))
        .limit(5) // Retry a few each time
        .all()
        
      for (const item of pendingItems) {
         console.log(`Retrying registration for existing pending email: ${item.email}`)
         try {
            const response = await fetch('https://tinify.com/web/api', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json, text/plain, */*',
                'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36',
                'Origin': 'https://tinify.com',
                'Referer': 'https://tinify.com/developers',
              },
              body: JSON.stringify({ 
                  fullName: item.email,
                  mail: item.email 
              })
            })
            
            if (response.ok) {
               console.log(`Retry successful for ${item.email}`)
               await db.update(tinypngKeyPool)
                 .set({ status: 'registered', updatedAt: new Date() })
                 .where(eq(tinypngKeyPool.id, item.id))
            } else {
                const text = await response.text()
                console.error(`Retry failed for ${item.email}: ${response.status} - ${text}`)
            }
         } catch (e) {
             console.error(`Retry network error for ${item.email}`, e)
         }
      }

    } catch (e) {
      console.error('Error in tinypng pool worker:', e)
    }
  }
}
