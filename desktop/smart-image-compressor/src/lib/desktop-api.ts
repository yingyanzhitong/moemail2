import { invoke, isTauri } from '@tauri-apps/api/core'
import type { BootstrapView, CompressionSummary, ImageJob, LicenseView } from '@/types'

const demoLicense: LicenseView = {
  id: 'preview',
  status: 'active',
  used: 3284,
  limit: 10000,
  startsAt: new Date().toISOString(),
  expiresAt: new Date(Date.now() + 18 * 86400000).toISOString(),
  scheduledPeriods: [],
}

export async function bootstrap(): Promise<BootstrapView> {
  if (!isTauri()) return { license: demoLicense, reconciledReservations: 0 }
  return invoke<BootstrapView>('bootstrap')
}

export async function takeActivationCode(): Promise<string | null> {
  return invoke<string | null>('take_activation_code')
}

export async function redeem(code: string): Promise<LicenseView> {
  return invoke<LicenseView>('redeem_activation', { code })
}

export async function refreshLicense(): Promise<LicenseView> {
  return invoke<LicenseView>('refresh_license')
}

export async function pickImages(): Promise<ImageJob[]> {
  return invoke<ImageJob[]>('pick_images')
}

export async function pickFolder(): Promise<ImageJob[]> {
  return invoke<ImageJob[]>('pick_folder')
}

export async function addDroppedPaths(paths: string[]): Promise<ImageJob[]> {
  return invoke<ImageJob[]>('add_paths', { paths })
}

export async function startCompression(ids: string[]): Promise<CompressionSummary> {
  return invoke<CompressionSummary>('start_compression', { ids })
}

export async function cancelCompression(): Promise<void> {
  return invoke('cancel_compression')
}
