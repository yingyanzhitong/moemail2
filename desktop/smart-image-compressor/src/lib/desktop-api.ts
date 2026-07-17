import { invoke, isTauri } from '@tauri-apps/api/core'
import type { ActivationPlanPreview, BootstrapView, CompressionStart, LicenseView, OutputMode } from '@/types'

const demoLicense: LicenseView = {
  id: 'preview',
  status: 'active',
  used: 3284,
  limit: 10000,
  tokenCount: 40,
  startsAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 18 * 86400000).toISOString(),
  scheduledPeriods: [],
}

export async function bootstrap(): Promise<BootstrapView> {
  if (!isTauri()) return { license: demoLicense, reconciledReservations: 0, pendingUsageReports: 0 }
  return invoke<BootstrapView>('bootstrap')
}

export async function takeActivationCode(): Promise<string | null> {
  return invoke<string | null>('take_activation_code')
}

export async function redeem(code: string): Promise<LicenseView> {
  return invoke<LicenseView>('redeem_activation', { code })
}

export async function previewActivation(code: string): Promise<ActivationPlanPreview> {
  if (!isTauri()) return {
    kind: 'new',
    tokenCount: 40,
    compressionLimit: 10000,
    durationDays: 30,
    redeemExpiresAt: new Date(Date.now() + 86400000).toISOString(),
  }
  return invoke<ActivationPlanPreview>('preview_activation', { code })
}

export async function refreshLicense(): Promise<LicenseView> {
  return invoke<LicenseView>('refresh_license')
}

export async function pickImages(): Promise<void> {
  return invoke('pick_images')
}

export async function pickFolder(): Promise<void> {
  return invoke('pick_folder')
}

export async function addDroppedPaths(paths: string[]): Promise<void> {
  return invoke('add_paths', { paths })
}

export async function requestThumbnails(ids: string[]): Promise<void> {
  if (!isTauri()) return
  return invoke('request_thumbnails', { ids })
}

export async function removeJobs(ids: string[]): Promise<void> {
  if (!isTauri()) return
  return invoke('remove_jobs', { ids })
}

export async function startCompression(ids: string[], outputMode: OutputMode): Promise<CompressionStart> {
  return invoke<CompressionStart>('start_compression', { ids, outputMode })
}

export async function cancelCompression(): Promise<void> {
  return invoke('cancel_compression')
}
