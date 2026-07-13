import { drizzle } from "drizzle-orm/d1"
import { eq, sql } from "drizzle-orm"
import { tinypngTaskRuns } from "./schema"

export function formatTinyPngTaskLog(message: string, at = new Date()): string {
  return `[${at.toISOString()}] ${message}`
}

export async function appendTinyPngTaskRunLog(
  database: D1Database,
  taskRunId: string | null | undefined,
  entry: string,
): Promise<void> {
  if (!taskRunId) return

  const db = drizzle(database, { schema: { tinypngTaskRuns } })
  await db
    .update(tinypngTaskRuns)
    .set({
      message: sql`${tinypngTaskRuns.message} || ${`\n\n${entry}`}`,
    })
    .where(eq(tinypngTaskRuns.id, taskRunId))
}
