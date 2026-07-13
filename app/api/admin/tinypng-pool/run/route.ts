import { getRequestContext } from "@cloudflare/next-on-pages"
import { auth, getUserRole } from "@/lib/auth"
import { getTinyPngPoolEmailDomain } from "@/lib/tinypng-pool-domain"
import { runTinyPngPoolTask } from "@/lib/tinypng-pool-task"
import { ROLES } from "@/lib/permissions"
import { NextResponse } from "next/server"

export const runtime = "edge"

export async function POST() {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  const role = await getUserRole(session.user.id)
  if (role !== ROLES.EMPEROR) {
    return NextResponse.json({ error: "仅皇帝可立即执行任务" }, { status: 403 })
  }

  const env = getRequestContext().env
  const emailDomain = await getTinyPngPoolEmailDomain(env.SITE_CONFIG, env.EMAIL_DOMAIN)
  const result = await runTinyPngPoolTask(env.DB, emailDomain)

  return NextResponse.json({ result })
}
