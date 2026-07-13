import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LicensePanel } from '@/components/license-panel'
import type { LicenseView } from '@/types'

const base: LicenseView = {
  id: 'license',
  status: 'active',
  used: 3200,
  limit: 10000,
  startsAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2099-08-01T00:00:00.000Z',
  scheduledPeriods: [],
}

function view(overrides: Partial<LicenseView> = {}) {
  return render(<LicensePanel license={{ ...base, ...overrides }} refreshing={false} onRefresh={vi.fn()} onActivate={vi.fn()} />)
}

describe('授权面板', () => {
  it('有效授权只展示逻辑额度，不展示 Key 或真实计数', () => {
    const { container } = view()
    expect(screen.getByText('授权有效')).toBeInTheDocument()
    expect(screen.getByText('3,200')).toBeInTheDocument()
    expect(screen.getByText('/ 10,000')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/api.?key|compression-count|40\s*key/i)
  })

  it('展示续费已排期', () => {
    view({ scheduledPeriods: [{ startsAt: '2099-08-01T00:00:00.000Z', expiresAt: '2099-08-31T00:00:00.000Z' }] })
    expect(screen.getByText('已排 1 期')).toBeInTheDocument()
  })

  it('在三天内到期时给出即将到期状态', () => {
    view({ expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() })
    expect(screen.getByText('授权即将到期')).toBeInTheDocument()
  })

  it.each([
    ['unlicensed', '等待激活'],
    ['expired', '授权已到期'],
    ['exhausted', '本期额度已用尽'],
    ['revoked', '授权已撤销'],
    ['offline', '无法连接授权服务'],
  ] satisfies Array<[LicenseView['status'], string]>)('状态 %s 会暂停新批次并提示恢复入口', (status, label) => {
    view({ status })
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('新批次已暂停')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '激活授权' })).toBeInTheDocument()
  })
})
