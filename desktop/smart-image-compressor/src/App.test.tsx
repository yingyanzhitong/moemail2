import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { App } from '@/App'
import type { ActivationPlanPreview, BootstrapView, LicenseView } from '@/types'

const { bootstrapMock, previewMock, redeemMock } = vi.hoisted(() => ({
  bootstrapMock: vi.fn<() => Promise<BootstrapView>>(),
  previewMock: vi.fn<(code: string) => Promise<ActivationPlanPreview>>(),
  redeemMock: vi.fn<(code: string) => Promise<LicenseView>>(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => false }))
vi.mock('@/lib/desktop-api', () => ({
  addDroppedPaths: vi.fn(),
  bootstrap: bootstrapMock,
  cancelCompression: vi.fn(),
  pickFolder: vi.fn(),
  pickImages: vi.fn(),
  queryTokenUsage: vi.fn(),
  requestThumbnails: vi.fn(),
  previewActivation: previewMock,
  redeem: redeemMock,
  refreshLicense: vi.fn(),
  removeJobs: vi.fn(),
  startCompression: vi.fn(),
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
    bootstrapMock.mockResolvedValue({ license: unlicensed, reconciledReservations: 0, pendingUsageReports: 0 })
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
    bootstrapMock.mockResolvedValue({ license: active, reconciledReservations: 0, pendingUsageReports: 0 })

    render(<App />)

    expect(await screen.findByRole('button', { name: '开始压缩' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: '激活后进入压缩工作台' })).not.toBeInTheDocument()
  })

  it('授权方案预览未完成时仍允许直接激活，避免界面卡在解析状态', async () => {
    bootstrapMock.mockResolvedValue({ license: unlicensed, reconciledReservations: 0, pendingUsageReports: 0 })
    previewMock.mockImplementation(() => new Promise<ActivationPlanPreview>(() => undefined))

    render(<App />)
    fireEvent.change(await screen.findByLabelText('Auth Link 或授权码'), {
      target: { value: 'https://compress.example.com/activate/grant-code-12345678901234567890' },
    })

    expect(screen.getByRole('button', { name: '激活并进入工作台' })).toBeEnabled()
  })

  it('后台同步使用记录时不在界面展示服务端回传状态', async () => {
    bootstrapMock.mockResolvedValue({ license: active, reconciledReservations: 0, pendingUsageReports: 2 })

    render(<App />)

    expect(await screen.findByRole('button', { name: '开始压缩' })).toBeInTheDocument()
    expect(screen.queryByText(/回传|对账/)).not.toBeInTheDocument()
  })

  it('工作台保留原生导入入口，并提供两种明确的输出策略', async () => {
    bootstrapMock.mockResolvedValue({ license: active, reconciledReservations: 0, pendingUsageReports: 0 })

    render(<App />)
    expect(await screen.findByRole('button', { name: '导入图片' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '导入文件夹' })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /导出到新文件夹/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /覆盖原文件/ })).not.toBeChecked()
  })
})
