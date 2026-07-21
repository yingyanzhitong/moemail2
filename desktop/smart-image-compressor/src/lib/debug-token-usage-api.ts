import { invoke, isTauri } from '@tauri-apps/api/core'
import type { TokenUsageReport } from '@/types'

export async function queryTokenUsage(packageId?: string): Promise<TokenUsageReport> {
  if (!isTauri()) {
    return {
      checkedAt: new Date().toISOString(),
      tokens: [
        { packageIndex: 1, index: 1, used: 201, limit: 500, status: 'active', resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString() },
        { packageIndex: 1, index: 2, used: 500, limit: 500, status: 'exhausted', resetAt: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 1).toISOString() },
      ],
    }
  }
  return invoke<TokenUsageReport>('query_token_usage', { packageId })
}
