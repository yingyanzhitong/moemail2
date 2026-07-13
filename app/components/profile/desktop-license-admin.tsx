'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Laptop, Loader2, RefreshCw, RotateCcw, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useToast } from '@/components/ui/use-toast'

interface DesktopLicenseAdminItem {
  id: string
  status: 'active' | 'pending' | 'expired' | 'exhausted' | 'revoked'
  used: number
  limit: number
  tokenCount: number
  startsAt: string | null
  expiresAt: string | null
  scheduledPeriods: Array<{ startsAt: string; expiresAt: string }>
  deviceBound: boolean
  keyCount: number
  createdAt: string
}

const STATUS_LABEL: Record<DesktopLicenseAdminItem['status'], string> = {
  active: '有效',
  pending: '待激活',
  expired: '已过期',
  exhausted: '额度用尽',
  revoked: '已撤销',
}

function formatDate(value: string | null) {
  return value ? new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)) : '—'
}

export function DesktopLicenseAdmin() {
  const [licenses, setLicenses] = useState<DesktopLicenseAdminItem[]>([])
  const [loading, setLoading] = useState(true)
  const [actionId, setActionId] = useState<string | null>(null)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const { toast } = useToast()

  const loadLicenses = useCallback(async () => {
    setLoading(true)
    try {
      const response = await fetch('/api/admin/tinypng-desktop/licenses', { cache: 'no-store' })
      if (!response.ok) throw new Error('获取桌面授权失败')
      const data = await response.json() as { licenses: DesktopLicenseAdminItem[] }
      setLicenses(data.licenses)
    } catch (error) {
      toast({ title: '加载失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    void loadLicenses()
  }, [loadLicenses])

  const generateGrant = async (licenseId: string, kind: 'renew' | 'rebind') => {
    setActionId(`${licenseId}:${kind}`)
    try {
      const response = await fetch('/api/tinypng/desktop/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, licenseId }),
      })
      const data = await response.json() as { authLink?: string; error?: string }
      if (!response.ok || !data.authLink) throw new Error(data.error || '生成链接失败')
      setGeneratedLink(data.authLink)
      toast({ title: kind === 'renew' ? '续费链接已生成' : '换机链接已生成', description: '链接将在 24 小时后失效。' })
    } catch (error) {
      toast({ title: '操作失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setActionId(null)
    }
  }

  const revoke = async (licenseId: string) => {
    if (!window.confirm('撤销后客户端会立即停止申请新额度，且已分配 Key 不会回收。确定继续吗？')) return
    setActionId(`${licenseId}:revoke`)
    try {
      const response = await fetch(`/api/admin/tinypng-desktop/licenses/${licenseId}/revoke`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error || '撤销失败')
      }
      await loadLicenses()
      toast({ title: '授权已撤销' })
    } catch (error) {
      toast({ title: '撤销失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setActionId(null)
    }
  }

  const copyLink = async () => {
    if (!generatedLink) return
    await navigator.clipboard.writeText(generatedLink)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <section className="space-y-4 rounded-lg border bg-background p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Laptop className="h-5 w-5 text-primary" />
            <h2 className="text-lg font-semibold">桌面端授权</h2>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">管理有效周期、续费排期、换机和撤销；此处不展示真实 Key 内容。</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => void loadLicenses()} disabled={loading}>
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          刷新授权
        </Button>
      </div>

      {generatedLink ? (
        <div className="rounded-lg border border-primary/20 bg-primary/5 p-3">
          <p className="mb-2 text-sm font-medium">刚生成的授权链接</p>
          <div className="flex gap-2">
            <Input readOnly value={generatedLink} className="font-mono text-xs" />
            <Button variant="outline" size="icon" onClick={copyLink} aria-label="复制授权链接">
              {copied ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="overflow-hidden rounded-lg border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>授权</TableHead>
              <TableHead>状态</TableHead>
              <TableHead>逻辑额度</TableHead>
              <TableHead>当前到期</TableHead>
              <TableHead>排队周期</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && licenses.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center"><Loader2 className="mx-auto h-4 w-4 animate-spin" /></TableCell></TableRow>
            ) : licenses.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="h-24 text-center text-muted-foreground">暂无桌面授权</TableCell></TableRow>
            ) : licenses.map((license) => (
              <TableRow key={license.id}>
                <TableCell>
                  <p className="font-mono text-xs">{license.id.slice(0, 12)}…</p>
                  <p className="mt-1 text-xs text-muted-foreground">{license.deviceBound ? '已绑定设备' : '未绑定设备'} · 授权 {license.tokenCount} Token · 当前 {license.keyCount} Key</p>
                </TableCell>
                <TableCell><span className="rounded-full bg-muted px-2 py-1 text-xs">{STATUS_LABEL[license.status]}</span></TableCell>
                <TableCell className="font-mono text-xs">{license.used.toLocaleString()} / {license.limit.toLocaleString()}</TableCell>
                <TableCell className="whitespace-nowrap text-sm">{formatDate(license.expiresAt)}</TableCell>
                <TableCell className="text-sm">{license.scheduledPeriods.length}</TableCell>
                <TableCell>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" disabled={license.status === 'revoked' || actionId !== null} onClick={() => void generateGrant(license.id, 'renew')}>
                      {actionId === `${license.id}:renew` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="mr-1 h-3.5 w-3.5" />}续费
                    </Button>
                    <Button variant="ghost" size="sm" disabled={license.status === 'revoked' || actionId !== null} onClick={() => void generateGrant(license.id, 'rebind')}>换机</Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={license.status === 'revoked' || actionId !== null} onClick={() => void revoke(license.id)}>
                      <ShieldOff className="mr-1 h-3.5 w-3.5" />撤销
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </section>
  )
}
