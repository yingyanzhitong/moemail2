import { auth } from "@/lib/auth"
import { createDb } from "@/lib/db"
import { tinypngKeyPool, emails } from "@/lib/schema"
import { NextResponse } from "next/server"
import { getUserRole, ROLES } from "@/lib/auth"
import { eq } from "drizzle-orm"
import { nanoid } from "nanoid"

export const runtime = "edge"

// Authorization code format: tinypng://<base64-encoded-json>
// JSON: { "code": "<random-token>", "count": <number-of-keys>, "expires": "<timestamp>" }

interface GenerateRequest {
  count: number
}

/**
 * POST: Generate an authorization code for the Electron app
 * Emperor only - this generates a one-time code that can be redeemed for API keys
 */
export async function POST(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 })
  }

  const role = await getUserRole(session.user.id)
  if (role !== ROLES.EMPEROR) {
    return NextResponse.json({ error: "Forbidden - Emperor role required" }, { status: 403 })
  }

  try {
    const body = await request.json() as GenerateRequest
    const count = Math.min(Math.max(1, body.count || 1), 50) // 1-50 keys max

    // Check if we have enough active keys in the pool
    const db = createDb()
    const activeKeys = await db.select().from(tinypngKeyPool)
      .where(eq(tinypngKeyPool.status, 'active'))
      .limit(count)
      .all()

    if (activeKeys.length < count) {
      return NextResponse.json({ 
        error: `Not enough keys in pool. Requested: ${count}, Available: ${activeKeys.length}` 
      }, { status: 400 })
    }

    // Generate the authorization code
    const code = nanoid(24)
    const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000) // 24 hours

    const payload = {
      code,
      count,
      expires: expiresAt.toISOString()
    }

    const base64Payload = Buffer.from(JSON.stringify(payload)).toString('base64')
    const authLink = `tinypng://${base64Payload}`

    // Store the code in a simple KV-like manner (we'll use the code as a "reservation" marker)
    // For simplicity, we can store it in localStorage on client or just validate it on redemption
    // Here we just return it - the actual validation happens on redeem

    return NextResponse.json({
      success: true,
      authLink,
      keyCount: count,
      expiresAt: expiresAt.toISOString(),
      // Also return the raw code for reference
      code
    })

  } catch (error) {
    console.error("Failed to generate auth code:", error)
    return NextResponse.json({ error: "Internal Server Error" }, { status: 500 })
  }
}
