export const TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY = "TINYPNG_POOL_EMAIL_DOMAIN"

const EMAIL_DOMAINS_CONFIG_KEY = "EMAIL_DOMAINS"

export function parseEmailDomains(value: string | null | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean)
}

export function resolveTinyPngPoolEmailDomain(
  emailDomains: string | null | undefined,
  selectedDomain: string | null | undefined,
  fallbackDomain?: string,
): string | undefined {
  const domains = parseEmailDomains(emailDomains)
  const selected = selectedDomain?.trim()
  const fallback = fallbackDomain?.trim()

  if (selected && domains.includes(selected)) return selected
  if (fallback && domains.includes(fallback)) return fallback

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
  const [emailDomains, selectedDomain] = await Promise.all([
    siteConfig.get(EMAIL_DOMAINS_CONFIG_KEY),
    siteConfig.get(TINYPNG_POOL_EMAIL_DOMAIN_CONFIG_KEY),
  ])

  return resolveTinyPngPoolEmailDomain(emailDomains, selectedDomain, fallbackDomain)
}
