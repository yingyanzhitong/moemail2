import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { TokenUsageDialog } from '@/components/token-usage-dialog'

describe('TinyPNG 使用情况弹窗', () => {
  it('仅展示 Token 序号、实际用量与自然月重置日期，不展示 Key 原文', () => {
    const { container } = render(
      <TokenUsageDialog
        open
        loading={false}
        error={null}
        onOpenChange={vi.fn()}
        onRefresh={vi.fn()}
        report={{
          checkedAt: '2026-07-18T03:00:00.000Z',
          tokens: [
            { packageIndex: 1, index: 1, used: 201, limit: 500, status: 'active', resetAt: '2026-08-01T00:00:00.000Z' },
            { packageIndex: 1, index: 2, used: 500, limit: 500, status: 'exhausted', resetAt: '2026-08-01T00:00:00.000Z' },
          ],
        }}
      />,
    )

    expect(screen.getByRole('heading', { name: 'TinyPNG 使用情况' })).toBeInTheDocument()
    expect(screen.getByText('套餐 1 · Token 01')).toBeInTheDocument()
    expect(screen.getByText('201 / 500')).toBeInTheDocument()
    expect(screen.getAllByText(/下次重置 2026\/08\/01/)).toHaveLength(2)
    expect(container.textContent).not.toMatch(/api[_ -]?key|secret/i)
  })
})
