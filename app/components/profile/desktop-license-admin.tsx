'use client'

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, KeyRound, Laptop, Link2, Loader2, RefreshCw, RotateCcw, ShieldOff } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  plan: { tokenCount: number; compressionLimit: number; durationDays: number } | null
  grantStatus: 'issued' | 'redeemed' | 'expired' | null
  grantExpiresAt: string | null
  hasActiveAuthLink: boolean
}

interface DesktopLicenseKeyItem {
  id: string
  email: string
  apiKey: string
  status: 'pending' | 'registered' | 'link_received' | 'active' | 'reserved' | 'assigned' | 'invalid' | 'used' | 'registration_failed'
  isEmergency: boolean
  assignedAt: string
  updatedAt: string
}

const STATUS_LABEL: Record<DesktopLicenseAdminItem['status'], string> = {
  active: '有效',
  pending: '待激活',
  expired: '已过期',
  exhausted: '额度用尽',
  revoked: '已停止',
}

const KEY_STATUS_LABEL: Record<DesktopLicenseKeyItem['status'], string> = {
  pending: '注册中',
  registered: '已注册',
  link_received: '已收链接',
  active: '可用',
  reserved: '已预留',
  assigned: '已分配',
  invalid: '已失效',
  used: '已使用',
  registration_failed: '注册失败',
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
  const [createDialogOpen, setCreateDialogOpen] = useState(false)
  const [createTokenCount, setCreateTokenCount] = useState(40)
  const [createLimit, setCreateLimit] = useState(10000)
  const [createDays, setCreateDays] = useState(30)
  const [renewTarget, setRenewTarget] = useState<DesktopLicenseAdminItem | null>(null)
  const [renewLimit, setRenewLimit] = useState(10000)
  const [renewDays, setRenewDays] = useState(30)
  const [keyDialogOpen, setKeyDialogOpen] = useState(false)
  const [keyLicense, setKeyLicense] = useState<DesktopLicenseAdminItem | null>(null)
  const [keys, setKeys] = useState<DesktopLicenseKeyItem[]>([])
  const [keysLoading, setKeysLoading] = useState(false)
  const [copiedKeyId, setCopiedKeyId] = useState<string | null>(null)
  const [copiedAuthLinkId, setCopiedAuthLinkId] = useState<string | null>(null)
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

  useEffect(() => {
    const handleLicenseCreated = () => void loadLicenses()
    window.addEventListener('desktop-license-created', handleLicenseCreated)
    return () => window.removeEventListener('desktop-license-created', handleLicenseCreated)
  }, [loadLicenses])

  const generateGrant = async (
    licenseId: string,
    kind: 'renew' | 'rebind',
    plan?: { compressionLimit: number; durationDays: number },
  ) => {
    setActionId(`${licenseId}:${kind}`)
    try {
      const response = await fetch('/api/tinypng/desktop/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ kind, licenseId, ...plan }),
      })
      const data = await response.json() as { authLink?: string; error?: string }
      if (!response.ok || !data.authLink) throw new Error(data.error || '生成链接失败')
      setGeneratedLink(data.authLink)
      if (kind === 'renew') setRenewTarget(null)
      await loadLicenses()
      toast({ title: kind === 'renew' ? '续费链接已生成' : '换机链接已生成', description: '链接将在 24 小时后失效。' })
    } catch (error) {
      toast({ title: '操作失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setActionId(null)
    }
  }

  const createAuthLink = async () => {
    setActionId('create')
    try {
      const response = await fetch('/api/tinypng/desktop/grants', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          kind: 'new',
          tokenCount: createTokenCount,
          compressionLimit: createLimit,
          durationDays: createDays,
        }),
      })
      const data = await response.json() as { authLink?: string; error?: string }
      if (!response.ok || !data.authLink) throw new Error(data.error || '创建链接失败')
      setGeneratedLink(data.authLink)
      setCreateDialogOpen(false)
      await loadLicenses()
      toast({ title: 'Auth Link 已创建', description: '链接将在 24 小时后失效。' })
    } catch (error) {
      toast({ title: '创建失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setActionId(null)
    }
  }

  const stopLicense = async (license: DesktopLicenseAdminItem) => {
    if (!window.confirm('停止后 Auth Link 立即失效，绑定 Token 会解除并返回 Pool。已安装的客户端需联网完成状态校验后才会删除本地 Token，确定继续吗？')) return
    const licenseId = license.id
    setActionId(`${licenseId}:revoke`)
    try {
      const response = await fetch(`/api/admin/tinypng-desktop/licenses/${licenseId}/revoke`, { method: 'POST' })
      if (!response.ok) {
        const data = await response.json() as { error?: string }
        throw new Error(data.error || '撤销失败')
      }
      await loadLicenses()
      toast({
        title: '授权已停止',
        description: '绑定 Token 已解除并返回 Pool。',
      })
    } catch (error) {
      toast({ title: '停止失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setActionId(null)
    }
  }

  const openRenewDialog = (license: DesktopLicenseAdminItem) => {
    setRenewTarget(license)
    setRenewLimit(license.limit || license.plan?.compressionLimit || 10000)
    setRenewDays(license.plan?.durationDays || 30)
  }

  const openKeyDialog = async (license: DesktopLicenseAdminItem) => {
    setKeyLicense(license)
    setKeys([])
    setCopiedKeyId(null)
    setKeyDialogOpen(true)
    setKeysLoading(true)
    try {
      const response = await fetch(`/api/admin/tinypng-desktop/licenses/${license.id}/keys`, { cache: 'no-store' })
      const data = await response.json() as { keys?: DesktopLicenseKeyItem[]; error?: string }
      if (!response.ok || !data.keys) throw new Error(data.error || '获取 Token 列表失败')
      setKeys(data.keys)
    } catch (error) {
      toast({ title: 'Token 列表加载失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
    } finally {
      setKeysLoading(false)
    }
  }

  const copyKey = async (value: string, id: string) => {
    await navigator.clipboard.writeText(value)
    setCopiedKeyId(id)
    window.setTimeout(() => setCopiedKeyId(null), 1600)
  }

  const copyAuthLink = async (licenseId: string) => {
    setActionId(`${licenseId}:copy-link`)
    try {
      const response = await fetch(`/api/admin/tinypng-desktop/licenses/${licenseId}/auth-link`, {
        method: 'POST',
        cache: 'no-store',
      })
      const data = await response.json() as { authLink?: string; error?: string }
      if (!response.ok || !data.authLink) throw new Error(data.error || '获取 Auth Link 失败')
      await navigator.clipboard.writeText(data.authLink)
      setCopiedAuthLinkId(licenseId)
      window.setTimeout(() => setCopiedAuthLinkId(null), 1600)
      toast({ title: 'Auth Link 已复制' })
    } catch (error) {
      toast({ title: '复制失败', description: error instanceof Error ? error.message : '请稍后重试', variant: 'destructive' })
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
          <p className="mt-1 text-sm text-muted-foreground">Auth Link 生成后立即记录；支持续费、换机、停止，并可按需查看真实 Token Key。</p>
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={() => setCreateDialogOpen(true)} disabled={actionId !== null}>
            <Link2 className="mr-2 h-4 w-4" />
            创建 Auth Link
          </Button>
          <Button variant="outline" size="sm" onClick={() => void loadLicenses()} disabled={loading || actionId !== null}>
            <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
            刷新授权
          </Button>
        </div>
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
              <TableHead>使用情况</TableHead>
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
                <TableCell>
                  <p className="font-mono text-xs">{license.used.toLocaleString()} / {license.limit.toLocaleString()}</p>
                  <p className="mt-1 text-xs text-muted-foreground">客户端压缩完成后回传</p>
                </TableCell>
                <TableCell className="whitespace-nowrap text-sm">
                  {license.status === 'pending' && license.plan ? (
                    <>
                      <span>激活后 {license.plan.durationDays} 天</span>
                      <p className="mt-1 text-xs text-muted-foreground">链接 {formatDate(license.grantExpiresAt)} 失效</p>
                    </>
                  ) : formatDate(license.expiresAt)}
                </TableCell>
                <TableCell className="text-sm">{license.scheduledPeriods.length}</TableCell>
                <TableCell>
                  <div className="flex flex-wrap justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={() => void openKeyDialog(license)}>
                      <KeyRound className="mr-1 h-3.5 w-3.5" />Token 列表
                    </Button>
                    <Button variant="ghost" size="sm" disabled={!license.hasActiveAuthLink || actionId !== null} onClick={() => void copyAuthLink(license.id)}>
                      {actionId === `${license.id}:copy-link`
                        ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />
                        : copiedAuthLinkId === license.id
                          ? <Check className="mr-1 h-3.5 w-3.5 text-emerald-600" />
                          : <Link2 className="mr-1 h-3.5 w-3.5" />}
                      复制 Auth Link
                    </Button>
                    <Button variant="ghost" size="sm" disabled={license.status === 'pending' || license.status === 'revoked' || actionId !== null} onClick={() => openRenewDialog(license)}>
                      <RotateCcw className="mr-1 h-3.5 w-3.5" />续费
                    </Button>
                    <Button variant="ghost" size="sm" disabled={license.status === 'pending' || license.status === 'revoked' || actionId !== null} onClick={() => void generateGrant(license.id, 'rebind', {
                      compressionLimit: license.limit || license.plan?.compressionLimit || 10000,
                      durationDays: license.plan?.durationDays || 30,
                    })}>换机</Button>
                    <Button variant="ghost" size="sm" className="text-destructive hover:text-destructive" disabled={license.status === 'revoked' || actionId !== null} onClick={() => void stopLicense(license)}>
                      {actionId === `${license.id}:revoke` ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <ShieldOff className="mr-1 h-3.5 w-3.5" />}{license.status === 'revoked' ? '已停止' : '停止'}
                    </Button>
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={createDialogOpen} onOpenChange={(open) => { if (!open && actionId === null) setCreateDialogOpen(false) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>创建 Auth Link</DialogTitle>
            <DialogDescription>链接 24 小时内有效且只能兑换一次；创建时会预留对应数量的 Token。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-2">
              <Label htmlFor="createTokenCount">Token 数量</Label>
              <Input id="createTokenCount" type="number" min={1} max={200} value={createTokenCount} onChange={(event) => setCreateTokenCount(Number(event.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="createCompressionLimit">可压缩张数</Label>
              <Input id="createCompressionLimit" type="number" min={1} max={1000000} value={createLimit} onChange={(event) => setCreateLimit(Number(event.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="createDurationDays">有效天数</Label>
              <Input id="createDurationDays" type="number" min={1} max={365} value={createDays} onChange={(event) => setCreateDays(Number(event.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={actionId !== null} onClick={() => setCreateDialogOpen(false)}>取消</Button>
            <Button
              disabled={actionId !== null || !Number.isInteger(createTokenCount) || createTokenCount < 1 || createTokenCount > 200 || !Number.isInteger(createLimit) || createLimit < 1 || createLimit > 1000000 || !Number.isInteger(createDays) || createDays < 1 || createDays > 365}
              onClick={() => void createAuthLink()}
            >
              {actionId === 'create' ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              创建链接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(renewTarget)} onOpenChange={(open) => { if (!open && actionId === null) setRenewTarget(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>生成续费 Auth Link</DialogTitle>
            <DialogDescription>Token 数量保持为 {renewTarget?.tokenCount ?? 0}，新的压缩额度与有效期由本次续费链接决定。</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label htmlFor="renewCompressionLimit">可压缩张数</Label>
              <Input id="renewCompressionLimit" type="number" min={1} max={1000000} value={renewLimit} onChange={(event) => setRenewLimit(Number(event.target.value))} />
            </div>
            <div className="space-y-2">
              <Label htmlFor="renewDurationDays">有效天数</Label>
              <Input id="renewDurationDays" type="number" min={1} max={365} value={renewDays} onChange={(event) => setRenewDays(Number(event.target.value))} />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" disabled={actionId !== null} onClick={() => setRenewTarget(null)}>取消</Button>
            <Button
              disabled={!renewTarget || actionId !== null || !Number.isInteger(renewLimit) || renewLimit < 1 || renewLimit > 1000000 || !Number.isInteger(renewDays) || renewDays < 1 || renewDays > 365}
              onClick={() => renewTarget && void generateGrant(renewTarget.id, 'renew', { compressionLimit: renewLimit, durationDays: renewDays })}
            >
              {renewTarget && actionId === `${renewTarget.id}:renew` ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              生成续费链接
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={keyDialogOpen} onOpenChange={(open) => {
        setKeyDialogOpen(open)
        if (!open) {
          setKeyLicense(null)
          setKeys([])
          setCopiedKeyId(null)
        }
      }}>
        <DialogContent className="max-h-[85vh] sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5 text-primary" />Token 列表与真实 Key</DialogTitle>
            <DialogDescription>
              授权 {keyLicense?.id.slice(0, 12) ?? ''}… · 仅管理员按需读取；Key 不会写入授权列表响应或前端日志。
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-[58vh] overflow-y-auto rounded-lg border">
            {keysLoading ? (
              <div className="flex h-32 items-center justify-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />正在读取 Token…</div>
            ) : keys.length === 0 ? (
              <div className="flex h-32 items-center justify-center text-sm text-muted-foreground">暂无已绑定 Token</div>
            ) : (
              <div className="divide-y">
                {keys.map((key, index) => (
                  <div key={key.id} className="space-y-2 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-mono text-xs text-muted-foreground">#{String(index + 1).padStart(2, '0')} · {key.email}</p>
                      </div>
                      <div className="flex items-center gap-2 text-xs">
                        <span className="rounded-full bg-muted px-2 py-1">{KEY_STATUS_LABEL[key.status]}</span>
                        <span className="rounded-full border px-2 py-1">{key.isEmergency ? '应急 Token' : '初始 Token'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-muted/50 p-2">
                      <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-foreground">{key.apiKey}</code>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" onClick={() => void copyKey(key.apiKey, key.id)} aria-label={`复制 ${key.email} 的真实 Key`}>
                        {copiedKeyId === key.id ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <DialogFooter className="items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">共 {keys.length} 个 Token</p>
            <Button variant="outline" disabled={keys.length === 0} onClick={() => void copyKey(keys.map((key) => key.apiKey).join('\n'), 'all')}>
              {copiedKeyId === 'all' ? <Check className="mr-2 h-4 w-4 text-emerald-600" /> : <Copy className="mr-2 h-4 w-4" />}
              复制全部真实 Key
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  )
}
