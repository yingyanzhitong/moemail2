import { useCallback, useEffect, useState } from 'react'
import '@/components/token-usage-debug.css'
import { TokenUsageDialog } from '@/components/token-usage-dialog'
import { queryTokenUsage } from '@/lib/debug-token-usage-api'
import type { TokenUsageReport } from '@/types'

const requestEvent = 'smartcompress:debug-token-usage'

function messageFromError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error)
  try {
    const parsed = JSON.parse(value) as { message?: string }
    return parsed.message ?? value
  } catch {
    return value
  }
}

export function TokenUsageDebug() {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [report, setReport] = useState<TokenUsageReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [packageId, setPackageId] = useState<string | undefined>()

  const inspect = useCallback((nextPackageId?: string) => {
    setPackageId(nextPackageId)
    setOpen(true)
    setLoading(true)
    setError(null)
    void queryTokenUsage(nextPackageId)
      .then(setReport)
      .catch((reason) => setError(messageFromError(reason)))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    const onRequest = (event: Event) => inspect((event as CustomEvent<string | undefined>).detail)
    window.addEventListener(requestEvent, onRequest)
    return () => window.removeEventListener(requestEvent, onRequest)
  }, [inspect])

  return <TokenUsageDialog open={open} loading={loading} report={report} error={error} onOpenChange={setOpen} onRefresh={() => inspect(packageId)} />
}
