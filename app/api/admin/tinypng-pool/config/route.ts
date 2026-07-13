import { getRequestContext } from "@cloudflare/next-on-pages"
import { auth, getUserRole } from "@/lib/auth"
import { parseEmailDomains, TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY } from "@/lib/tinypng-pool-domain"
import { ROLES } from "@/lib/permissions"
import { NextResponse } from "next/server"

export const runtime = "edge"

export async function PUT(request: Request) {
  const session = await auth()
  if (!session?.user?.id) {
    return NextResponse.json({ error: "请先登录" }, { status: 401 })
  }

  const role = await getUserRole(session.user.id)
  if (role !== ROLES.EMPEROR) {
    return NextResponse.json({ error: "仅皇帝可配置 TinyPNG Pool 邮箱域名" }, { status: 403 })
  }

  const { emailDomain } = await request.json() as { emailDomain?: string }
  const selectedDomain = emailDomain?.trim()
  const env = getRequestContext().env
  const domains = parseEmailDomains(await env.SITE_CONFIG.get("EMAIL_DOMAINS"))

  if (!selectedDomain || !domains.includes(selectedDomain)) {
    return NextResponse.json(
      { error: "请选择已配置的邮箱域名" },
      { status: 400 },
    )
  }

  await env.SITE_CONFIG.put(TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY, selectedDomain)

  return NextResponse.json({ emailDomain: selectedDomain })
}
