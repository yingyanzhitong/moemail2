export type LicenseStatus = 'unlicensed' | 'active' | 'pending' | 'expired' | 'exhausted' | 'revoked' | 'offline' | 'clock_invalid'
export type FileStatus = 'queued' | 'compressing' | 'completed' | 'failed' | 'skipped' | 'cancelled'
export type CompressionStage = 'preparing' | 'reading' | 'uploading' | 'downloading' | 'writing'
export type OutputMode = 'new_folder' | 'overwrite'

export interface LicenseView {
  id: string | null
  status: LicenseStatus
  used: number
  limit: number
  tokenCount: number
  startsAt: string | null
  expiresAt: string | null
  scheduledPeriods: Array<{ startsAt: string; expiresAt: string; limit: number }>
  message?: string
}

export interface ActivationPlanPreview {
  kind: 'new' | 'renew' | 'rebind'
  tokenCount: number
  compressionLimit: number
  durationDays: number
  redeemExpiresAt: string
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
  stage?: CompressionStage | null
  compressedSize?: number
  savingsPercent?: number
  error?: string
}

export interface ThumbnailReady {
  id: string
  thumbnailDataUrl: string
}

export interface BootstrapView {
  license: LicenseView
  reconciledReservations: number
  pendingUsageReports: number
}

export interface CompressionProgress {
  id: string
  status: FileStatus
  stage: CompressionStage | null
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
  pendingUsageReports: number
}

export interface CompressionStart {
  acceptedCount: number
}

export interface CompressionFinished {
  summary?: CompressionSummary
  error?: string
}

export interface ScanComplete {
  discovered: number
  skipped: number
}
