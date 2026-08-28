import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  getPurchaseConfig: vi.fn(),
  openPurchaseUrl: vi.fn(),
  toDataURL: vi.fn(),
}))

vi.mock('@/lib/desktop-api', () => ({
  getPurchaseConfig: mocks.getPurchaseConfig,
  openPurchaseUrl: mocks.openPurchaseUrl,
}))

vi.mock('qrcode', () => ({
  default: { toDataURL: mocks.toDataURL },
}))

import { PurchaseEntry } from '@/components/purchase-entry'

describe('闲鱼购买入口', () => {
  beforeEach(() => {
    mocks.getPurchaseConfig.mockReset()
    mocks.openPurchaseUrl.mockReset()
    mocks.toDataURL.mockReset()
    mocks.openPurchaseUrl.mockResolvedValue(undefined)
    mocks.toDataURL.mockResolvedValue('data:image/png;base64,qr')
  })

  it('使用购买链接生成二维码并从电脑打开闲鱼', async () => {
    const purchaseUrl = 'https://www.goofish.com/item?id=1'
    mocks.getPurchaseConfig.mockResolvedValue({ purchaseUrl })

    render(<PurchaseEntry />)

    const button = await screen.findByRole('button', { name: '电脑打开闲鱼' })
    expect(await screen.findByAltText('闲鱼购买二维码')).toHaveAttribute('src', 'data:image/png;base64,qr')
    expect(mocks.toDataURL).toHaveBeenCalledWith(purchaseUrl, expect.objectContaining({ width: 320 }))

    fireEvent.click(button)
    await waitFor(() => expect(mocks.openPurchaseUrl).toHaveBeenCalledWith(purchaseUrl))
  })

  it('未配置购买链接时不展示入口', async () => {
    mocks.getPurchaseConfig.mockResolvedValue(null)

    render(<PurchaseEntry />)

    await waitFor(() => expect(mocks.getPurchaseConfig).toHaveBeenCalled())
    expect(screen.queryByRole('button', { name: '电脑打开闲鱼' })).not.toBeInTheDocument()
  })
})
