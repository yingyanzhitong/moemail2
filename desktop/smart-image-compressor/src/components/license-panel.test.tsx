import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { LicensePanel } from '@/components/license-panel'
import type { LicenseView } from '@/types'

const base: LicenseView = {
  id: 'license',
  status: 'active',
  used: 3200,
  limit: 12345,
  tokenCount: 24,
  startsAt: '2026-07-01T00:00:00.000Z',
  expiresAt: '2099-08-01T00:00:00.000Z',
  scheduledPeriods: [],
}

function view(overrides: Partial<LicenseView> = {}) {
  return render(
    <LicensePanel
      license={{ ...base, ...overrides }}
      refreshing={false}
      onRefresh={vi.fn()}
      onActivate={vi.fn()}
      outputMode="new_folder"
      outputDisabled={false}
      onOutputModeChange={vi.fn()}
    />,
  )
}

describe('授权面板', () => {
  it('有效授权展示 Auth Link 授予的 Token 数量和逻辑额度，不展示敏感内容', () => {
    const { container } = view()
    expect(screen.getByText('授权有效')).toBeInTheDocument()
    expect(screen.getByText('3,200')).toBeInTheDocument()
    expect(screen.getByText('/ 12,345')).toBeInTheDocument()
    expect(screen.getByText('Token 数量')).toBeInTheDocument()
    expect(screen.getByText('24')).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/api.?key|compression-count/i)
  })

  it('展示续费已排期', () => {
    view({ scheduledPeriods: [{ startsAt: '2099-08-01T00:00:00.000Z', expiresAt: '2099-08-31T00:00:00.000Z', limit: 20000 }] })
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
    ['clock_invalid', '系统时间异常'],
  ] satisfies Array<[LicenseView['status'], string]>)('状态 %s 会暂停新批次并提示恢复入口', (status, label) => {
    view({ status })
    expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByText('新批次已暂停')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '激活授权' })).toBeInTheDocument()
  })

  it('仅展示新文件夹和覆盖原文件两种输出方式', () => {
    view()
    expect(screen.getByRole('radio', { name: /导出到新文件夹/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /覆盖原文件/ })).not.toBeChecked()
    expect(screen.queryByText(/副本/)).not.toBeInTheDocument()
  })
})
