import { Env } from '../types'
import { drizzle } from 'drizzle-orm/d1'
import { emails, tinypngKeyPool } from '../app/lib/schema'
import { count, eq } from 'drizzle-orm'

// Configuration
const POOL_LIMIT = 500
const BATCH_SIZE = 10

export default {
  async scheduled(_: ScheduledEvent, env: Env) {
    const db = drizzle(env.DB, { schema: { emails, tinypngKeyPool } })
    
    try {
      // Check pool size
      // We count both pending and active keys found in the pool
      const poolCountResult = await db.select({ value: count() })
        .from(tinypngKeyPool)
        .where(eq(tinypngKeyPool.status, 'pending')) // Count just pending? Or all? User said limit 500. Assuming simple limit.
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
          expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30), // 30 days
          createdAt: new Date(),
        })
        
        // 2. Insert into Tinypng Pool
        await db.insert(tinypngKeyPool).values({
          email: emailAddress,
          status: 'pending'
        })
        
        // 3. Request Key from TinyPNG
        try {
            const response = await fetch('https://tinypng.com/web/apikey', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'Mozilla/5.0 (compatible; Moemail/1.0)'
              },
              body: JSON.stringify({ mail: emailAddress })
            })
            
            if (!response.ok) {
               console.error(`Failed to request key for ${emailAddress}: ${response.status}`)
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
