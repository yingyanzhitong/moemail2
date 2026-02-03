import { createDb } from "@/lib/db"
import { tinypngKeyPool, emails } from "@/lib/schema"
import { NextResponse } from "next/server"
import { eq } from "drizzle-orm"

export const runtime = "edge"

interface RedeemRequest {
  code: string
  count: number
}

/**
 * POST: Redeem an authorization code for API keys
 * This is called by the Electron app to exchange a code for actual API keys
 */
export async function POST(request: Request) {
  try {
    const body = await request.json() as RedeemRequest
    const { code, count } = body

    if (!code || !count) {
      return NextResponse.json({ error: "Missing code or count" }, { status: 400 })
    }

    // Validate count
    if (count < 1 || count > 50) {
      return NextResponse.json({ error: "Invalid count (1-50)" }, { status: 400 })
    }

    const db = createDb()

    // Get active keys from the pool
    const activeKeys = await db.select().from(tinypngKeyPool)
      .where(eq(tinypngKeyPool.status, 'active'))
      .limit(count)
      .all()

    if (activeKeys.length < count) {
      return NextResponse.json({ 
        error: `Not enough keys available. Requested: ${count}, Available: ${activeKeys.length}` 
      }, { status: 400 })
    }

    const apiKeys: string[] = []
    const now = new Date()

    // Mark these keys as used and collect them
    for (const key of activeKeys) {
      if (key.apiKey) {
        apiKeys.push(key.apiKey)

        // Update associated email expiration to 1 hour (standard for claimed keys)
        const emailRecord = await db.select().from(emails)
          .where(eq(emails.address, key.email))
          .limit(1)
          .get()

        if (emailRecord) {
          await db.update(emails)
            .set({ 
              expiresAt: new Date(now.getTime() + 60 * 60 * 1000) // 1 hour
            })
            .where(eq(emails.id, emailRecord.id))
        }

        // Mark key as used
        await db.update(tinypngKeyPool)
          .set({ status: 'used', updatedAt: now })
          .where(eq(tinypngKeyPool.id, key.id))
      }
    }

    if (apiKeys.length === 0) {
      return NextResponse.json({ error: "No valid keys found" }, { status: 400 })
    }

    return NextResponse.json({
      success: true,
      apiKeys,
      count: apiKeys.length
    })

  } catch (error) {
    console.error("Failed to redeem auth code:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
