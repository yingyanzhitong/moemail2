import { fireEvent, render, screen } from '@testing-library/react'
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
  packages: [{
    id: 'license',
    status: 'active',
    used: 3200,
    limit: 12345,
    startsAt: '2026-07-01T00:00:00.000Z',
    expiresAt: '2099-08-01T00:00:00.000Z',
    scheduledPeriods: [],
  }],
}

function view(overrides: Partial<LicenseView> = {}) {
  const onInspectUsage = vi.fn()
  const onDeletePackage = vi.fn()
  const { packages: overridePackages, ...rootOverrides } = overrides
  const license = { ...base, ...rootOverrides }
  license.packages = overridePackages ?? [{
    ...base.packages[0],
    status: license.status,
    used: license.used,
    limit: license.limit,
    startsAt: license.startsAt,
    expiresAt: license.expiresAt,
    scheduledPeriods: license.scheduledPeriods,
    message: license.message,
  }]
  const result = render(
    <LicensePanel
      license={license}
      refreshing={false}
      onRefresh={vi.fn()}
      debugUsageEnabled
      onInspectUsage={onInspectUsage}
      usageDisabled={false}
      onDeletePackage={onDeletePackage}
      deletingPackageId={null}
      onActivate={vi.fn()}
      outputMode="new_folder"
      outputDisabled={false}
      onOutputModeChange={vi.fn()}
    />,
  )
  return { ...result, onInspectUsage, onDeletePackage }
}

describe('授权面板', () => {
  it('有效授权仅展示逻辑额度，不展示 Token 数量或敏感内容', () => {
    const { container } = view()
    expect(screen.getByRole('heading', { name: '授权有效' })).toBeInTheDocument()
    expect(screen.getByText('3,200')).toBeInTheDocument()
    expect(screen.getByText('/ 12,345')).toBeInTheDocument()
    expect(screen.queryByText('Token 数量')).not.toBeInTheDocument()
    expect(screen.queryByText('24')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/api.?key|compression-count/i)
  })

  it('展示续费已排期', () => {
    view({ scheduledPeriods: [{ startsAt: '2099-08-01T00:00:00.000Z', expiresAt: '2099-08-31T00:00:00.000Z', limit: 20000 }] })
    expect(screen.getByText('套餐 1 · 续费期 1')).toBeInTheDocument()
    expect(screen.getByText('已排期')).toBeInTheDocument()
  })

  it('在三天内到期时给出即将到期状态', () => {
    view({ expiresAt: new Date(Date.now() + 2 * 86400000).toISOString() })
    expect(screen.getByRole('heading', { name: '授权即将到期' })).toBeInTheDocument()
  })

  it.each([
    ['unlicensed', '等待激活'],
    ['expired', '授权已到期'],
    ['exhausted', '本期额度已用尽'],
    ['revoked', '套餐已失效'],
    ['offline', '无法连接授权服务'],
    ['clock_invalid', '系统时间异常'],
  ] satisfies Array<[LicenseView['status'], string]>)('状态 %s 会暂停新批次并提示恢复入口', (status, label) => {
    view({ status })
    expect(screen.getByRole('heading', { name: label })).toBeInTheDocument()
    expect(screen.getByText('新批次已暂停')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '激活授权' })).toBeInTheDocument()
  })

  it('仅展示新文件夹和覆盖原文件两种输出方式', () => {
    view()
    expect(screen.getByRole('radio', { name: /导出到新文件夹/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /覆盖原文件/ })).not.toBeChecked()
    expect(screen.queryByText(/副本/)).not.toBeInTheDocument()
  })

  it('点击逻辑额度卡片时打开 TinyPNG 使用情况入口', () => {
    const { onInspectUsage } = view()
    fireEvent.click(screen.getByRole('button', { name: '查看套餐 1的 TinyPNG Token 使用情况' }))
    expect(onInspectUsage).toHaveBeenCalledWith('license')
  })

  it('关闭开发调试开关后不提供 TinyPNG 使用情况入口', () => {
    const onInspectUsage = vi.fn()
    render(
      <LicensePanel
        license={base}
        refreshing={false}
        onRefresh={vi.fn()}
        debugUsageEnabled={false}
        onInspectUsage={onInspectUsage}
        usageDisabled={false}
        onDeletePackage={vi.fn()}
        deletingPackageId={null}
        onActivate={vi.fn()}
        outputMode="new_folder"
        outputDisabled={false}
        onOutputModeChange={vi.fn()}
      />,
    )
    expect(screen.queryByRole('button', { name: '查看套餐 1的 TinyPNG Token 使用情况' })).not.toBeInTheDocument()
    expect(onInspectUsage).not.toHaveBeenCalled()
  })

  it('分开展示旧套餐和从今天开始的新套餐，并标注优先使用顺序', () => {
    view({
      packages: [
        base.packages[0],
        {
          id: 'new-license',
          status: 'active',
          used: 12,
          limit: 10000,
          startsAt: '2026-07-21T00:00:00.000Z',
          expiresAt: '2026-08-20T00:00:00.000Z',
          scheduledPeriods: [],
        },
      ],
    })
    expect(screen.getByText('套餐 1')).toBeInTheDocument()
    expect(screen.getByText('套餐 2')).toBeInTheDocument()
    expect(screen.getByText('优先使用')).toBeInTheDocument()
    expect(screen.getByText('后续使用')).toBeInTheDocument()
  })

  it('失效套餐可删除本地记录，其他套餐不显示删除操作', () => {
    const { onDeletePackage } = view({
      packages: [{
        ...base.packages[0],
        id: 'revoked-license',
        status: 'revoked',
        message: '该套餐已在管理端停止，本地 TinyPNG Token 已删除。',
      }],
    })
    fireEvent.click(screen.getByRole('button', { name: '删除套餐 1的本地记录' }))
    expect(onDeletePackage).toHaveBeenCalledWith('revoked-license')
  })

  it('有效套餐不显示删除操作', () => {
    view()
    expect(screen.queryByRole('button', { name: /删除套餐/ })).not.toBeInTheDocument()
  })
})
