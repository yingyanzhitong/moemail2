import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { emails, tinypngKeyPool } from '../app/lib/schema'
import { count, eq, inArray, and, lt } from 'drizzle-orm'

// Configuration
const POOL_LIMIT = 500
const BATCH_SIZE = 10

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    const db = drizzle(env.DB, { schema: { emails, tinypngKeyPool } })
    
    try {

      // 0. Cleanup stale pending items from previous cycles (older than 10 minutes)
      const staleThreshold = new Date(Date.now() - 10 * 60 * 1000)
      const staleItems = await db.select().from(tinypngKeyPool)
        .where(and(
          eq(tinypngKeyPool.status, 'pending'),
          lt(tinypngKeyPool.createdAt, staleThreshold)
        ))
        .all()
        
      if (staleItems.length > 0) {
          console.log(`Cleaning up ${staleItems.length} stale pending items`)
          for (const item of staleItems) {
              await db.delete(tinypngKeyPool).where(eq(tinypngKeyPool.id, item.id))
              // Also delete the email to free up space and keep things clean
              await db.delete(emails).where(eq(emails.address, item.email))
          }
      }

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
                // Mark as failed so we know why it's stuck
                await db.update(tinypngKeyPool)
                  .set({ 
                    status: 'registration_failed', 
                    errorMessage: `${response.status} - ${text.substring(0, 200)}`,
                    updatedAt: new Date()
                  })
                  .where(eq(tinypngKeyPool.email, emailAddress))
            } else {
               console.log(`Requested key for ${emailAddress}`)
               // Update status to 'registered'
               await db.update(tinypngKeyPool)
                 .set({ status: 'registered', updatedAt: new Date() })
                 .where(eq(tinypngKeyPool.email, emailAddress))
            }
        } catch (reqErr) {
            console.error(`Network error requesting key for ${emailAddress}`, reqErr)
            await db.update(tinypngKeyPool)
              .set({ 
                status: 'registration_failed', 
                errorMessage: reqErr instanceof Error ? reqErr.message : String(reqErr),
                updatedAt: new Date()
              })
              .where(eq(tinypngKeyPool.email, emailAddress))
        }
      }
      
      // 4. Retry Logic removed as per request to just delete pending items in next cycle.

    } catch (e) {
      console.error('Error in tinypng pool worker:', e)
    }
  }
}
