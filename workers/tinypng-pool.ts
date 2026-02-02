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
    
    try {
      // Clean up pending records from previous runs
      await db.delete(tinypngKeyPool).where(eq(tinypngKeyPool.status, 'pending'))
      
      // Check pool size
      // We count both pending and active keys found in the pool
      const poolCountResult = await db.select({ value: count() })
        .from(tinypngKeyPool)
        .where(inArray(tinypngKeyPool.status, ['pending', 'active']))
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
        
        // 2. Insert into Tinypng Pool
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
            } else {
               console.log(`Requested key for ${emailAddress}`)
            }
        } catch (reqErr) {
            console.error(`Network error requesting key for ${emailAddress}`, reqErr)
        }
      }

    } catch (e) {
      console.error('Error in tinypng pool worker:', e)
    }
  }
}
