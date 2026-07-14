import { CalendarClock, CircleGauge, FolderOutput, KeyRound, Replace, RotateCw, ShieldAlert } from 'lucide-react'
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
    <aside className="flex min-h-0 flex-col gap-4">
      <section className="rounded-xl border border-[#D6DDE8] bg-white p-5">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#778196]">License calibration</p>
            <div className="mt-2 flex items-center gap-2">
              <span className={`h-2 w-2 rounded-full ${active ? 'bg-[#15806A]' : 'bg-[#C53D47]'}`} />
              <h2 className="text-sm font-semibold">{statusText}</h2>
            </div>
          </div>
          <Button variant="ghost" size="icon" onClick={onRefresh} disabled={refreshing || license.status === 'unlicensed'} aria-label="重新校验本地授权">
            <RotateCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
          </Button>
        </div>

        <div className="mt-6 flex items-end justify-between">
          <div>
            <p className="font-mono text-[30px] font-semibold leading-none tracking-tight">{license.used.toLocaleString()}</p>
            <p className="mt-2 text-xs text-[#667085]">已压缩数量</p>
          </div>
          <p className="font-mono text-sm text-[#667085]">/ {license.limit.toLocaleString()}</p>
        </div>
        <Progress value={percent} className="mt-4" aria-label={`已使用 ${percent.toFixed(1)}%`} />
        <div className="mt-2 flex justify-between font-mono text-[10px] text-[#8792A5]"><span>0</span><span>{license.limit.toLocaleString()}</span></div>

        <div className="mt-5 grid gap-3 border-t border-[#E1E6EE] pt-4 text-sm">
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[#667085]"><KeyRound className="h-4 w-4" />Token 数量</span>
            <span className="font-mono text-xs">{license.tokenCount.toLocaleString()}</span>
          </div>
          <div className="flex items-center justify-between gap-3">
            <span className="flex items-center gap-2 text-[#667085]"><CalendarClock className="h-4 w-4" />当前周期</span>
            <span className="font-mono text-xs">至 {formatDate(license.expiresAt)}</span>
          </div>
          {license.scheduledPeriods.length > 0 ? (
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-[#667085]"><CircleGauge className="h-4 w-4" />续费排期</span>
              <span className="text-xs text-[#15806A]">已排 {license.scheduledPeriods.length} 期</span>
            </div>
          ) : null}
        </div>

        {!active ? (
          <div className="mt-5 rounded-[8px] border border-[#C53D47]/20 bg-[#C53D47]/5 p-3">
            <p className="flex items-center gap-2 text-xs font-medium text-[#A4313A]"><ShieldAlert className="h-4 w-4" />新批次已暂停</p>
            <p className="mt-1 text-xs leading-5 text-[#7A4A4F]">{license.message ?? '队列和历史结果仍可查看，粘贴新授权链接后即可继续。'}</p>
          </div>
        ) : null}
        <Button className="mt-4 w-full" variant={active ? 'outline' : 'default'} onClick={onActivate}>{active ? '粘贴续费或换机链接' : '激活授权'}</Button>
      </section>

      <section className="rounded-xl border border-[#D6DDE8] bg-white p-5">
        <div className="flex items-center gap-2"><FolderOutput className="h-4 w-4 text-[#2956D8]" /><h2 className="text-sm font-semibold">输出位置</h2></div>
        <div className="mt-4 grid gap-2" role="radiogroup" aria-label="输出方式">
          <button
            type="button"
            role="radio"
            aria-checked={outputMode === 'new_folder'}
            disabled={outputDisabled}
            onClick={() => onOutputModeChange('new_folder')}
            className={`rounded-[9px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${outputMode === 'new_folder' ? 'border-[#2956D8] bg-[#2956D8]/5' : 'border-[#D6DDE8] hover:border-[#AEBBD0]'}`}
          >
            <span className="text-xs font-semibold text-[#172033]">导出到新文件夹</span>
            <span className="mt-1 block text-[11px] leading-4 text-[#667085]">生成“压缩结果”目录并保留原文件。</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={outputMode === 'overwrite'}
            disabled={outputDisabled}
            onClick={() => onOutputModeChange('overwrite')}
            className={`rounded-[9px] border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${outputMode === 'overwrite' ? 'border-[#C53D47] bg-[#C53D47]/5' : 'border-[#D6DDE8] hover:border-[#AEBBD0]'}`}
          >
            <span className="flex items-center gap-1.5 text-xs font-semibold text-[#172033]"><Replace className="h-3.5 w-3.5 text-[#C53D47]" />覆盖原文件</span>
            <span className="mt-1 block text-[11px] leading-4 text-[#667085]">直接替换源图片，开始前需要再次确认。</span>
          </button>
        </div>
      </section>
    </aside>
  )
}
