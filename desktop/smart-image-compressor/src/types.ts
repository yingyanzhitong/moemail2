export type LicenseStatus = 'unlicensed' | 'active' | 'pending' | 'expired' | 'exhausted' | 'revoked' | 'offline'
export type FileStatus = 'queued' | 'compressing' | 'completed' | 'failed' | 'skipped' | 'cancelled'

export interface LicenseView {
  id: string | null
  status: LicenseStatus
  used: number
  limit: number
  startsAt: string | null
  expiresAt: string | null
  scheduledPeriods: Array<{ startsAt: string; expiresAt: string }>
  message?: string
}

export interface ImageJob {
  id: string
  name: string
  sourcePath: string
  outputPath: string
  parentLabel: string
  originalSize: number
  thumbnailDataUrl: string | null
}

export interface QueueItem extends ImageJob {
  status: FileStatus
  compressedSize?: number
  savingsPercent?: number
  error?: string
}

export interface BootstrapView {
  license: LicenseView
  reconciledReservations: number
}

export interface CompressionProgress {
  id: string
  status: FileStatus
  compressedSize?: number
  savingsPercent?: number
  error?: string
}

export interface CompressionSummary {
  completed: number
  failed: number
  skipped: number
  cancelled: number
  license: LicenseView
}
