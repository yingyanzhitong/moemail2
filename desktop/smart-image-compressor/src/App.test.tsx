import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import type { ActivationPlanPreview, BootstrapView, CompressionSummary, ImageJob, LicenseView, OutputMode } from '@/types'

const { bootstrapMock, previewMock, redeemMock, pickImagesMock, startCompressionMock } = vi.hoisted(() => ({
  bootstrapMock: vi.fn<() => Promise<BootstrapView>>(),
  previewMock: vi.fn<(code: string) => Promise<ActivationPlanPreview>>(),
  redeemMock: vi.fn<(code: string) => Promise<LicenseView>>(),
  pickImagesMock: vi.fn<() => Promise<ImageJob[]>>(),
  startCompressionMock: vi.fn<(ids: string[], outputMode: OutputMode) => Promise<CompressionSummary>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('@/lib/desktop-api', () => ({
  addDroppedPaths: vi.fn(),
  bootstrap: bootstrapMock,
  cancelCompression: vi.fn(),
  pickFolder: vi.fn(),
  pickImages: pickImagesMock,
  previewActivation: previewMock,
  redeem: redeemMock,
  refreshLicense: vi.fn(),
  startCompression: startCompressionMock,
  takeActivationCode: vi.fn(),
}))

const unlicensed: LicenseView = {
  id: null,
  status: 'unlicensed',
  used: 0,
  limit: 0,
  tokenCount: 0,
  startsAt: null,
  expiresAt: null,
  scheduledPeriods: [],
}

const active: LicenseView = {
  ...unlicensed,
  id: 'license-1',
  status: 'active',
  limit: 12345,
  tokenCount: 24,
  startsAt: '2026-07-13T00:00:00.000Z',
  expiresAt: '2026-08-12T00:00:00.000Z',
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('桌面端授权入口', () => {
  it('首次启动只展示激活页，激活成功后进入工作台', async () => {
    bootstrapMock.mockResolvedValue({ license: unlicensed, reconciledReservations: 0 })
    previewMock.mockResolvedValue({
      kind: 'new',
      tokenCount: 24,
      compressionLimit: 12345,
      durationDays: 90,
      redeemExpiresAt: '2026-07-14T00:00:00.000Z',
    })
    redeemMock.mockResolvedValue(active)

    render(<App />)

    expect(await screen.findByRole('heading', { name: '激活后进入压缩工作台' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '开始压缩' })).not.toBeInTheDocument()
    expect(screen.queryByText('添加图片')).not.toBeInTheDocument()
    expect(screen.queryByText('10,000')).not.toBeInTheDocument()
    expect(screen.queryByText('30 天')).not.toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Auth Link 或授权码'), {
      target: { value: 'https://compress.example.com/activate/grant-code-12345678901234567890' },
    })

    expect(await screen.findByText('12,345')).toBeInTheDocument()
    expect(screen.getByText('90 天')).toBeInTheDocument()
    expect(previewMock).toHaveBeenCalledWith('grant-code-12345678901234567890')
    fireEvent.click(screen.getByRole('button', { name: '激活并进入工作台' }))

    await waitFor(() => expect(redeemMock).toHaveBeenCalledWith('grant-code-12345678901234567890'))
    expect(await screen.findByRole('button', { name: '开始压缩' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '激活后进入压缩工作台' })).not.toBeInTheDocument()
  })

  it('已有授权启动后直接进入工作台', async () => {
    bootstrapMock.mockResolvedValue({ license: active, reconciledReservations: 0 })

    render(<App />)

    expect(await screen.findByRole('button', { name: '开始压缩' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '激活后进入压缩工作台' })).not.toBeInTheDocument()
  })

  it('覆盖原文件必须二次确认后才开始压缩', async () => {
    bootstrapMock.mockResolvedValue({ license: active, reconciledReservations: 0 })
    pickImagesMock.mockResolvedValue([{
      id: 'image-1',
      name: '照片.png',
      sourcePath: '/图片/照片.png',
      outputPath: '/图片/压缩结果/照片.png',
      parentLabel: '/图片',
      originalSize: 1024,
      thumbnailDataUrl: null,
    }])
    startCompressionMock.mockResolvedValue({
      completed: 1,
      failed: 0,
      skipped: 0,
      cancelled: 0,
      license: { ...active, used: 1 },
    })

    render(<App />)
    fireEvent.click(await screen.findByRole('button', { name: '选择图片' }))
    expect(await screen.findByText('照片.png')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('radio', { name: /覆盖原文件/ }))
    fireEvent.click(screen.getByRole('button', { name: '开始压缩' }))

    expect(await screen.findByRole('heading', { name: '确认覆盖 1 张原图？' })).toBeInTheDocument()
    expect(startCompressionMock).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: '确认覆盖并开始' }))
    await waitFor(() => expect(startCompressionMock).toHaveBeenCalledWith(['image-1'], 'overwrite'))
  })
})
