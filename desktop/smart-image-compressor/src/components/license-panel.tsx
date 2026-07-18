import { CalendarClock, CircleGauge, FolderOutput, Replace, RotateCw, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import type { LicenseView, OutputMode } from '@/types'

function formatDate(value: string | null) {
  if (!value) return '尚未激活'
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

const STATUS_TEXT: Record<LicenseView['status'], string> = {
  unlicensed: '等待激活',
  active: '授权有效',
  pending: '续费已排期',
  expired: '授权已到期',
  exhausted: '本期额度已用尽',
  revoked: '授权已撤销',
  offline: '无法连接授权服务',
  clock_invalid: '系统时间异常',
}

interface LicensePanelProps {
  license: LicenseView
  refreshing: boolean
  onRefresh: () => void
  onActivate: () => void
  outputMode: OutputMode
  outputDisabled: boolean
  onOutputModeChange: (mode: OutputMode) => void
}

export function LicensePanel({ license, refreshing, onRefresh, onActivate, outputMode, outputDisabled, onOutputModeChange }: LicensePanelProps) {
  const percent = license.limit > 0 ? Math.min(100, license.used / license.limit * 100) : 0
  const active = license.status === 'active'
  const expiresSoon = active && license.expiresAt !== null && new Date(license.expiresAt).getTime() - Date.now() <= 3 * 86400000
  const statusText = expiresSoon ? '授权即将到期' : STATUS_TEXT[license.status]
  return (
    <aside className="inspector-panel" aria-label="授权与输出设置">
      <section className="inspector-group">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="inspector-label">套餐</p>
            <div className="mt-1.5 flex items-center gap-2"><span className={`h-2 w-2 rounded-full ${active ? 'bg-[#26845B]' : 'bg-[#C13C45]'}`} /><h2 className="text-[13px] font-semibold text-[#1D1D1F]">{statusText}</h2></div>
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={refreshing || license.status === 'unlicensed'} aria-label="重新校验本地授权"><RotateCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} /></Button>
        </div>

        <div className="mt-5 rounded-xl bg-[#F5F5F7] p-3.5">
          <div className="flex items-end justify-between"><div><p className="font-mono text-[28px] font-semibold leading-none tracking-tight text-[#1D1D1F]">{license.used.toLocaleString()}</p><p className="mt-1.5 text-[11px] text-[#6E6E73]">已压缩数量</p></div><p className="font-mono text-[12px] text-[#6E6E73]">/ {license.limit.toLocaleString()}</p></div>
          <Progress value={percent} className="mt-3 h-1.5" aria-label={`已使用 ${percent.toFixed(1)}%`} />
        </div>

        <dl className="inspector-details mt-3">
          <div><dt><CalendarClock className="h-3.5 w-3.5" />到期时间</dt><dd>{formatDate(license.expiresAt)}</dd></div>
          {license.scheduledPeriods.length > 0 ? <div><dt><CircleGauge className="h-3.5 w-3.5" />续费排期</dt><dd className="text-[#26845B]">已排 {license.scheduledPeriods.length} 期</dd></div> : null}
        </dl>

        {!active ? <div className="mt-3 rounded-lg bg-[#FFF1F1] px-3 py-2.5"><p className="flex items-center gap-1.5 text-[11px] font-medium text-[#B4232B]"><ShieldAlert className="h-3.5 w-3.5" />新批次已暂停</p><p className="mt-1 text-[11px] leading-4 text-[#8D464B]">{license.message ?? '粘贴新的授权链接后可继续使用。'}</p></div> : null}
        <Button className="mt-3 w-full" variant={active ? 'outline' : 'default'} size="sm" onClick={onActivate}>{active ? '续费或换机' : '激活授权'}</Button>
      </section>

      <section className="inspector-group">
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
    </aside>
  )
}
