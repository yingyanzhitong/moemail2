import { FolderOutput, Replace, RotateCw, ShieldAlert, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { LicensePackage, LicenseStatus, LicenseView, OutputMode } from '@/types'

function formatDate(value: string | null) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

const STATUS_TEXT: Record<LicenseStatus, string> = {
  unlicensed: '等待激活',
  active: '授权有效',
  pending: '等待生效',
  expired: '授权已到期',
  exhausted: '本期额度已用尽',
  revoked: '套餐已失效',
  offline: '无法连接授权服务',
  clock_invalid: '系统时间异常',
}

interface DisplayPackage extends LicensePackage {
  label: string
  priority: string
  scheduled: boolean
}

function displayPackages(license: LicenseView): DisplayPackage[] {
  const packages = license.packages.length > 0
    ? license.packages
    : license.id
      ? [{
          id: license.id,
          status: license.status,
          used: license.used,
          limit: license.limit,
          startsAt: license.startsAt,
          expiresAt: license.expiresAt,
          scheduledPeriods: license.scheduledPeriods,
          message: license.message,
        }]
      : []
  return packages.flatMap((item, index) => {
    const position = index + 1
    const current: DisplayPackage = {
      ...item,
      label: `套餐 ${position}`,
      priority: position === 1 ? '优先使用' : '后续使用',
      scheduled: false,
    }
    const scheduled = item.scheduledPeriods.map((period, scheduledIndex) => ({
      id: item.id,
      status: 'pending' as const,
      used: 0,
      limit: period.limit,
      startsAt: period.startsAt,
      expiresAt: period.expiresAt,
      scheduledPeriods: [],
      label: `套餐 ${position} · 续费期 ${scheduledIndex + 1}`,
      priority: '到期后生效',
      scheduled: true,
    }))
    return [current, ...scheduled]
  })
}

function displayStatus(item: Pick<LicensePackage, 'status' | 'expiresAt'>) {
  if (item.status === 'active' && item.expiresAt) {
    const remaining = new Date(item.expiresAt).getTime() - Date.now()
    if (remaining > 0 && remaining <= 3 * 24 * 60 * 60 * 1000) return '授权即将到期'
  }
  return STATUS_TEXT[item.status]
}

interface LicensePanelProps {
  license: LicenseView
  refreshing: boolean
  onRefresh: () => void
  debugUsageEnabled: boolean
  onInspectUsage?: (packageId?: string) => void
  usageDisabled: boolean
  onDeletePackage: (packageId: string) => void
  deletingPackageId: string | null
  onActivate: () => void
  outputMode: OutputMode
  outputDisabled: boolean
  onOutputModeChange: (mode: OutputMode) => void
}

interface PackageCardProps {
  item: DisplayPackage
  debugUsageEnabled: boolean
  usageDisabled: boolean
  deleting: boolean
  onInspectUsage?: (packageId: string) => void
  onDeletePackage: (packageId: string) => void
}

function PackageCard({ item, debugUsageEnabled, usageDisabled, deleting, onInspectUsage, onDeletePackage }: PackageCardProps) {
  const percent = item.limit > 0 ? Math.min(100, item.used / item.limit * 100) : 0
  const status = displayStatus(item)
  const content = <>
    <div className="flex items-center justify-between gap-2 text-left"><span className="text-[11px] font-semibold text-[#343438]">{item.label}</span><span className={`package-status package-status-${item.status}`}>{item.scheduled ? '已排期' : status}</span></div>
    <div className="mt-3 flex items-end justify-between"><div><p className="font-mono text-[24px] font-semibold leading-none tracking-tight text-[#1D1D1F]">{item.used.toLocaleString()}</p><p className="mt-1.5 text-[11px] text-[#6E6E73]">已压缩数量</p></div><p className="font-mono text-[12px] text-[#6E6E73]">/ {item.limit.toLocaleString()}</p></div>
    <Progress value={percent} className="mt-3 h-1.5" aria-label={`${item.label} 已使用 ${percent.toFixed(1)}%`} />
    <div className="package-period mt-2"><span>{item.priority}</span><span>{formatDate(item.startsAt)} — {formatDate(item.expiresAt)}</span></div>
  </>

  if (item.status === 'revoked' && !item.scheduled) {
    return <article className="quota-card package-card package-card-static" aria-label={`${item.label}已失效`}>{content}<button type="button" className="package-delete" disabled={deleting} onClick={() => onDeletePackage(item.id)} aria-label={`删除${item.label}的本地记录`}><Trash2 className="h-3.5 w-3.5" />{deleting ? '正在删除' : '删除套餐'}</button></article>
  }

  if (!debugUsageEnabled || !onInspectUsage) {
    return <article className={`quota-card package-card package-card-static ${item.scheduled ? 'package-card-pending' : ''}`}>{content}</article>
  }

  return <button type="button" className={`quota-card package-card ${item.scheduled ? 'package-card-pending' : ''}`} onClick={() => onInspectUsage(item.id)} disabled={usageDisabled} aria-label={`查看${item.label}的 TinyPNG Token 使用情况`}>{content}</button>
}

export function LicensePanel({ license, refreshing, onRefresh, debugUsageEnabled, onInspectUsage, usageDisabled, onDeletePackage, deletingPackageId, onActivate, outputMode, outputDisabled, onOutputModeChange }: LicensePanelProps) {
  const packages = displayPackages(license)
  const headerStatus = displayStatus(license)
  return (
    <aside className="inspector-panel" aria-label="套餐与输出设置">
      <section className="inspector-group" aria-label="输出方式设置">
        <div className="flex items-center gap-2"><FolderOutput className="h-4 w-4 text-[#0A63C9]" /><h2 className="text-[13px] font-semibold text-[#1D1D1F]">输出方式</h2></div>
        <div className="mt-3 grid gap-2" role="radiogroup" aria-label="输出方式">
          <button type="button" role="radio" aria-checked={outputMode === 'new_folder'} disabled={outputDisabled} onClick={() => onOutputModeChange('new_folder')} className={`output-choice ${outputMode === 'new_folder' ? 'output-choice-active' : ''}`}>
            <span>导出到新文件夹</span><small>保留原图，在同级创建结果目录。</small>
          </button>
          <button type="button" role="radio" aria-checked={outputMode === 'overwrite'} disabled={outputDisabled} onClick={() => onOutputModeChange('overwrite')} className={`output-choice ${outputMode === 'overwrite' ? 'output-choice-danger' : ''}`}>
            <span className="flex items-center gap-1.5"><Replace className="h-3.5 w-3.5 text-[#C13C45]" />覆盖原文件</span><small>开始前会再次确认，无法恢复原图。</small>
          </button>
        </div>
      </section>

      <section className="inspector-group" aria-label="套餐信息">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inspector-label">套餐</p>
            <div className="mt-1.5 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${license.status === 'active' ? 'bg-[#26845B]' : 'bg-[#C13C45]'}`} /><h2 className="text-[13px] font-semibold text-[#1D1D1F]">{headerStatus}</h2></div>
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={refreshing || license.status === 'unlicensed'} aria-label="重新校验本地授权"><RotateCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></Button>
        </div>

        <div className="package-stack mt-4">
          {packages.map((item) => <PackageCard key={`${item.id}:${item.label}`} item={item} debugUsageEnabled={debugUsageEnabled} usageDisabled={usageDisabled} deleting={deletingPackageId === item.id} onInspectUsage={onInspectUsage} onDeletePackage={onDeletePackage} />)}
        </div>

        {license.status !== 'active' ? <div className="mt-3 rounded-lg bg-[#FFF1F1] px-3 py-2.5"><p className="flex items-center gap-1.5 text-[11px] font-medium text-[#B4232B]"><ShieldAlert className="h-3.5 w-3.5" />新批次已暂停</p><p className="mt-1 text-[11px] leading-4 text-[#8D464B]">{license.message ?? '粘贴新的授权链接后可继续使用。'}</p></div> : null}
        <Button className="mt-3 w-full" variant={license.status === 'active' ? 'outline' : 'default'} size="sm" onClick={onActivate}>{license.status === 'active' ? '添加套餐或续费' : '激活授权'}</Button>
      </section>

    </aside>
  )
}
