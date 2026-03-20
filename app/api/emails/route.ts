import { createDb } from "@/lib/db"
import { and, eq, gt, inArray, lt, or, sql } from "drizzle-orm"
import { NextResponse } from "next/server"
import { emails, emailShares, messages, messageShares } from "@/lib/schema"
import { encodeCursor, decodeCursor } from "@/lib/cursor"
import { getUserId } from "@/lib/apiKey"

export const runtime = "edge"

const PAGE_SIZE = 20

export async function GET(request: Request) {
  const userId = await getUserId()

  const { searchParams } = new URL(request.url)
  const cursor = searchParams.get('cursor')
  const query = searchParams.get('q')?.trim().toLowerCase() || ""
  
  const db = createDb()

  try {
    const baseConditions = and(
      eq(emails.userId, userId!),
      gt(emails.expiresAt, new Date()),
      query ? sql`LOWER(${emails.address}) LIKE ${`%${query}%`}` : undefined
    )

    const totalResult = await db.select({ count: sql<number>`count(*)` })
      .from(emails)
      .where(baseConditions)
    const totalCount = Number(totalResult[0].count)

    const conditions = [baseConditions]

    if (cursor) {
      const { timestamp, id } = decodeCursor(cursor)
      conditions.push(
        or(
          lt(emails.createdAt, new Date(timestamp)),
          and(
            eq(emails.createdAt, new Date(timestamp)),
            lt(emails.id, id)
          )
        )
      )
    }

    const results = await db.query.emails.findMany({
      where: and(...conditions),
      orderBy: (emails, { desc }) => [
        desc(emails.createdAt),
        desc(emails.id)
      ],
      limit: PAGE_SIZE + 1
    })
    
    const hasMore = results.length > PAGE_SIZE
    const nextCursor = hasMore 
      ? encodeCursor(
          results[PAGE_SIZE - 1].createdAt.getTime(),
          results[PAGE_SIZE - 1].id
        )
      : null
    const emailList = (hasMore ? results.slice(0, PAGE_SIZE) : results).map((email) => ({
      ...email,
      createdAt: email.createdAt.getTime(),
      expiresAt: email.expiresAt.getTime(),
    }))

    return NextResponse.json({ 
      emails: emailList,
      nextCursor,
      total: totalCount
    })
  } catch (error) {
    console.error('Failed to fetch user emails:', error)
    return NextResponse.json(
      { error: "Failed to fetch emails" },
      { status: 500 }
    )
  }
} 

export async function DELETE(request: Request) {
  const userId = await getUserId()
  const db = createDb()

  try {
    const body = (await request.json()) as { olderThanDays?: number | string }
    const olderThanDays = Number.parseInt(String(body.olderThanDays ?? ""), 10)

    if (!Number.isInteger(olderThanDays) || olderThanDays <= 0) {
      return NextResponse.json(
        { error: "删除天数必须是大于 0 的整数" },
        { status: 400 }
      )
    }

    const thresholdDate = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000)

    const targetEmails = await db.query.emails.findMany({
      columns: {
        id: true,
      },
      where: and(
        eq(emails.userId, userId!),
        lt(emails.createdAt, thresholdDate),
        gt(emails.expiresAt, new Date())
      ),
    })

    if (targetEmails.length === 0) {
      return NextResponse.json({ deletedCount: 0 })
    }

    const emailIds = targetEmails.map((email) => email.id)
    const relatedMessages = await db.query.messages.findMany({
      columns: {
        id: true,
      },
      where: inArray(messages.emailId, emailIds),
    })
    const messageIds = relatedMessages.map((message) => message.id)

    if (messageIds.length > 0) {
      await db.delete(messageShares).where(inArray(messageShares.messageId, messageIds))
    }

    await db.delete(emailShares).where(inArray(emailShares.emailId, emailIds))
    await db.delete(messages).where(inArray(messages.emailId, emailIds))
    await db.delete(emails).where(inArray(emails.id, emailIds))

    return NextResponse.json({ deletedCount: emailIds.length })
  } catch (error) {
    console.error("Failed to bulk delete emails:", error)
    return NextResponse.json(
      { error: "批量删除邮箱失败" },
      { status: 500 }
    )
  }
}
