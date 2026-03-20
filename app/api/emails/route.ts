import { createDb } from "@/lib/db"
import { and, eq, gt, lt, or, sql } from "drizzle-orm"
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
    const deleteCondition = and(
      eq(emails.userId, userId!),
      lt(emails.createdAt, thresholdDate)
    )

    const targetCountResult = await db.select({ count: sql<number>`count(*)` })
      .from(emails)
      .where(deleteCondition)
    const deletedCount = Number(targetCountResult[0]?.count ?? 0)

    if (deletedCount === 0) {
      return NextResponse.json({ deletedCount: 0 })
    }

    const targetEmailsSubquery = sql`
      select ${emails.id}
      from ${emails}
      where ${deleteCondition}
    `
    const targetMessagesSubquery = sql`
      select ${messages.id}
      from ${messages}
      where ${messages.emailId} in (${targetEmailsSubquery})
    `

    await db.transaction(async (tx) => {
      await tx.delete(messageShares).where(
        sql`${messageShares.messageId} in (${targetMessagesSubquery})`
      )
      await tx.delete(emailShares).where(
        sql`${emailShares.emailId} in (${targetEmailsSubquery})`
      )
      await tx.delete(messages).where(
        sql`${messages.emailId} in (${targetEmailsSubquery})`
      )
      await tx.delete(emails).where(deleteCondition)
    })

    return NextResponse.json({ deletedCount })
  } catch (error) {
    console.error("Failed to bulk delete emails:", error)
    return NextResponse.json(
      { error: "批量删除邮箱失败" },
      { status: 500 }
    )
  }
}
