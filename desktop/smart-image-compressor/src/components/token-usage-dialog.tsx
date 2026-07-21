import { AlertCircle, CheckCircle2, Clock3, Loader2, RefreshCw, ShieldX } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'
import type { TokenUsage, TokenUsageReport } from '@/types'

const statusMeta = {
  active: { label: '可用', icon: CheckCircle2, className: 'text-[#26845B]' },
  exhausted: { label: '本月已用尽', icon: Clock3, className: 'text-[#B05A00]' },
  invalid: { label: '不可用', icon: ShieldX, className: 'text-[#C13C45]' },
  unavailable: { label: '暂无法获取', icon: AlertCircle, className: 'text-[#6E6E73]' },
} as const

function formatResetDate(value: string) {
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value))
}

function TokenUsageRow({ token }: { token: TokenUsage }) {
  const meta = statusMeta[token.status]
  const Icon = meta.icon
  const percent = token.used === undefined ? 0 : Math.min(100, token.used / token.limit * 100)
  return (
    <article className="token-usage-row">
      <div className="flex min-w-0 items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="font-mono text-[12px] font-medium text-[#1D1D1F]">套餐 {token.packageIndex} · Token {String(token.index).padStart(2, '0')}</p>
          <p className="mt-1 flex items-center gap-1 text-[10px] text-[#6E6E73]"><Clock3 className="h-3 w-3" />下次重置 {formatResetDate(token.resetAt)}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="font-mono text-[13px] text-[#343438]">{token.used === undefined ? '—' : `${token.used.toLocaleString()} / ${token.limit.toLocaleString()}`}</p>
          <p className={`mt-1 flex items-center justify-end gap-1 text-[10px] ${meta.className}`}><Icon className="h-3 w-3" />{meta.label}</p>
        </div>
      </div>
      <Progress value={percent} className="mt-2.5 h-1" aria-label={`Token ${token.index} 已使用 ${token.used ?? '未知'} 次`} />
      {token.message ? <p className="mt-2 text-[10px] leading-4 text-[#6E6E73]">{token.message}</p> : null}
    </article>
  )
}

interface TokenUsageDialogProps {
  open: boolean
  loading: boolean
  report: TokenUsageReport | null
  error: string | null
  onOpenChange: (open: boolean) => void
  onRefresh: () => void
}

export function TokenUsageDialog({ open, loading, report, error, onOpenChange, onRefresh }: TokenUsageDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-[540px]">
        <DialogHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-[#0A63C9]/10 text-[#0A63C9]"><Clock3 className="h-5 w-5" /></div>
          <DialogTitle>TinyPNG 使用情况</DialogTitle>
          <DialogDescription>逐个校验本机保存的 Token，并读取 TinyPNG 当前自然月计数；不会上传图片，Token 原文不会显示。</DialogDescription>
        </DialogHeader>

        <div className="mt-5 flex items-center justify-between gap-3">
          <p className="text-[11px] text-[#6E6E73]" aria-live="polite">{report ? `已查询 ${report.tokens.length.toLocaleString()} 个 Token` : loading ? '正在向 TinyPNG 查询…' : '尚未获取使用情况'}</p>
          <Button variant="outline" size="sm" onClick={onRefresh} disabled={loading}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />重新查询</Button>
        </div>

        {loading ? <div className="flex h-44 items-center justify-center gap-2 text-[12px] text-[#6E6E73]"><Loader2 className="h-4 w-4 animate-spin text-[#0A63C9]" />正在读取 TinyPNG 使用情况…</div> : error ? <div role="alert" className="mt-4 rounded-lg border border-[#F1C5C7] bg-[#FFF5F5] px-3 py-2.5 text-[12px] leading-5 text-[#A5353B]">{error}</div> : report ? <div className="token-usage-list mt-4" role="list" aria-label="TinyPNG Token 使用情况">{report.tokens.map((token) => <TokenUsageRow key={`${token.packageIndex}:${token.index}`} token={token} />)}</div> : null}
      </DialogContent>
    </Dialog>
  )
}
