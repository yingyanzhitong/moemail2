'use client'

import { useId, useState } from 'react'
import { Check, Copy, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  DESKTOP_INITIAL_KEY_COUNT,
  DESKTOP_MAX_GRANT_KEY_COUNT,
  DESKTOP_MAX_PERIOD_DAYS,
  DESKTOP_PERIOD_DAYS,
  DESKTOP_TOKEN_CAPACITY,
  type DesktopGrantPlan,
} from '@/lib/desktop-license-types'

interface DesktopAuthLinkDialogProps {
  onClose: () => void
  onCreated: () => void
}

export function DesktopAuthLinkDialog({ onClose, onCreated }: DesktopAuthLinkDialogProps) {
  const id = useId()
  const [tokenCount, setTokenCount] = useState(String(DESKTOP_INITIAL_KEY_COUNT))
  const [compressionLimit, setCompressionLimit] = useState(String(DESKTOP_INITIAL_KEY_COUNT * DESKTOP_TOKEN_CAPACITY / 2))
  const [durationDays, setDurationDays] = useState(String(DESKTOP_PERIOD_DAYS))
  const [buyerId, setBuyerId] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{ token: string; plan: DesktopGrantPlan } | null>(null)
  const [copied, setCopied] = useState(false)
  const plan = { tokenCount: Number(tokenCount), compressionLimit: Number(compressionLimit), durationDays: Number(durationDays) }
  const maxCompressionLimit = plan.tokenCount * DESKTOP_TOKEN_CAPACITY
  const valid = Number.isInteger(plan.tokenCount) && plan.tokenCount >= 1 && plan.tokenCount <= DESKTOP_MAX_GRANT_KEY_COUNT
    && Number.isInteger(plan.compressionLimit) && plan.compressionLimit >= 1 && plan.compressionLimit <= maxCompressionLimit
    && Number.isInteger(plan.durationDays) && plan.durationDays >= 1 && plan.durationDays <= DESKTOP_MAX_PERIOD_DAYS

  const createAuthLink = async () => {
    if (loading || !valid) return
    setLoading(true)
    setError(null)
    try {
      const response = await fetch('/api/tinypng/desktop/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind: 'new', ...plan, buyer_id: buyerId.trim() || undefined }),
      })
      const data = await response.json() as { token?: string; error?: string }
      if (!response.ok || !data.token) throw new Error(data.error || '创建授权链接失败')
      setResult({ token: data.token, plan })
      onCreated()
    } catch (error) {
      setError(error instanceof Error ? error.message : '请稍后重试')
    } finally {
      setLoading(false)
    }
  }

  const copyToken = async () => {
    if (!result) return
    try {
      await navigator.clipboard.writeText(result.token)
      setCopied(true)
    } catch {
      setError('复制失败，请手动复制授权 Token')
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !loading) onClose() }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>创建 Auth Link</DialogTitle>
          <DialogDescription>链接 1 个月内有效且只能兑换一次；创建时会预留对应数量的 Token。</DialogDescription>
        </DialogHeader>
        {result ? (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor={`${id}-result`}>授权 Token</Label>
              <div className="flex gap-2">
                <Input id={`${id}-result`} readOnly value={result.token} className="font-mono text-xs" />
                <Button size="icon" variant="outline" onClick={() => void copyToken()} aria-label="复制授权 Token">
                  {copied ? <Check className="h-4 w-4 text-green-500" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">直接粘贴到桌面端即可激活；Token 将在 1 个月后失效，且只能兑换一次。</p>
              <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                {result.plan.tokenCount} Token · {result.plan.compressionLimit.toLocaleString()} 张 · 激活后 {result.plan.durationDays} 天有效
              </p>
            </div>
          </div>
        ) : (
          <form id={`${id}-form`} className="space-y-4" onSubmit={(event) => { event.preventDefault(); void createAuthLink() }}>
            <div className="grid grid-cols-3 gap-3">
              <div className="space-y-2">
                <Label htmlFor={`${id}-tokens`}>Token 数量</Label>
                <Input id={`${id}-tokens`} type="number" min={1} max={DESKTOP_MAX_GRANT_KEY_COUNT} step={1} value={tokenCount} disabled={loading} onChange={(event) => {
                  const value = event.target.value
                  setTokenCount(value)
                  const count = Number(value)
                  setCompressionLimit(Number.isInteger(count) && count >= 1 && count <= DESKTOP_MAX_GRANT_KEY_COUNT ? String(count * DESKTOP_TOKEN_CAPACITY / 2) : '')
                }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-limit`}>可压缩张数</Label>
                <Input id={`${id}-limit`} type="number" min={1} max={maxCompressionLimit} step={1} value={compressionLimit} disabled={loading} onChange={(event) => {
                  const value = event.target.value
                  setCompressionLimit(value === '' ? '' : String(Math.min(Number(value), maxCompressionLimit)))
                }} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${id}-days`}>有效天数</Label>
                <Input id={`${id}-days`} type="number" min={1} max={DESKTOP_MAX_PERIOD_DAYS} step={1} value={durationDays} disabled={loading} onChange={(event) => setDurationDays(event.target.value)} />
              </div>
            </div>
            <p className="text-xs text-muted-foreground">每个 Token 可压缩 500 张，默认使用一半额度；当前最多 {Number.isFinite(maxCompressionLimit) ? maxCompressionLimit.toLocaleString() : 0} 张。</p>
            <div className="space-y-2">
              <Label htmlFor={`${id}-buyer`}>买家 ID</Label>
              <Input id={`${id}-buyer`} maxLength={128} value={buyerId} disabled={loading} onChange={(event) => setBuyerId(event.target.value)} placeholder="选填" />
            </div>
          </form>
        )}
        {error ? <p role="alert" className="rounded-lg bg-destructive/10 p-3 text-sm text-destructive">{error}</p> : null}
        <DialogFooter>
          <Button variant="outline" disabled={loading} onClick={onClose}>{result ? '关闭' : '取消'}</Button>
          {result ? (
            <Button onClick={() => { setResult(null); setCopied(false); setError(null) }}>再生成一个</Button>
          ) : (
            <Button type="submit" form={`${id}-form`} disabled={loading || !valid}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              创建链接
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
