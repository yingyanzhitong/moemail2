const EMAIL_DOMAINS_CONFIG_KEY = "EMAIL_DOMAINS"

export function parseEmailDomains(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean)
}

export function resolveTinyPngPoolEmailDomain(
  emailDomains: string | null | undefined,
  fallbackDomain?: string,
): string | undefined {
  const domains = parseEmailDomains(emailDomains)
  const fallback = fallbackDomain?.trim()

  return domains[0] || fallback
}

export function resolveTinyPngWorkerEmailDomain(
  workerEmailDomain: string | null | undefined,
  defaultEmailDomain: string,
): string {
  return workerEmailDomain?.trim() || defaultEmailDomain.trim()
}

export async function getTinyPngPoolEmailDomain(
  siteConfig: Pick<KVNamespace, "get">,
  fallbackDomain?: string,
): Promise<string | undefined> {
  const emailDomains = await siteConfig.get(EMAIL_DOMAINS_CONFIG_KEY)

  return resolveTinyPngPoolEmailDomain(emailDomains, fallbackDomain)
}
