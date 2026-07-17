"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Activity, Database, Link, Copy, Check, Loader2, Clock3, History, MapPin, Network, Play, ScrollText, Server, Wrench } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale, useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useToast } from "@/components/ui/use-toast"

type TinyPngTaskRunStatus = 'running' | 'success' | 'partial_failure' | 'skipped' | 'failed'
type TinyPngWorkerStatus = 'idle' | TinyPngTaskRunStatus

interface TinyPngWorkerState {
  id: string
  name: string
  role: 'coordinator' | 'registrar'
  configuredRegion: string | null
  actualPlacement: string | null
  emailDomain: string | null
  enabled: boolean
  maintenanceOwner: boolean
  status: TinyPngWorkerStatus
  lastRunAt: string | null
  lastError: string | null
  lastRun: {
    id: string
    status: TinyPngTaskRunStatus
    createdCount: number
    cleanedCount: number
    failedCount: number
    successfulCount: number
    successRate: number | null
    completedAt: string
  } | null
}

interface TinyPngTaskStatus {
  scheduleLabel: string
  nextRunAt: string
  lastRun: {
    id: string
    status: TinyPngTaskRunStatus
    message: string
    createdCount: number
    cleanedCount: number
    failedCount: number
    successfulCount: number
    successRate: number | null
    durationMs: number
    completedAt: string
    logs: string[]
  } | null
}

interface PoolStats {
  total: number
  active: number
  pending: number
  used: number
  reserved: number
  assigned: number
  invalid: number
  desktopLicenses: number
  emailDomains: string[]
  emailDomain: string
  cronExpression: string
  workers: TinyPngWorkerState[]
  taskStatus: TinyPngTaskStatus
}

interface GenerateResponse {
  success: boolean
  licenseId?: string
  authLink?: string
  expiresAt?: string
  code?: string
  plan?: {
    tokenCount: number
    compressionLimit: number
    durationDays: number
  }
  error?: string
}

const TASK_STATUS_META: Record<TinyPngTaskRunStatus, { label: string; className: string }> = {
  running: { label: '执行中', className: 'text-sky-600 dark:text-sky-400' },
  success: { label: '执行成功', className: 'text-emerald-600 dark:text-emerald-400' },
  partial_failure: { label: '部分失败', className: 'text-amber-600 dark:text-amber-400' },
  skipped: { label: '本次跳过', className: 'text-muted-foreground' },
  failed: { label: '执行失败', className: 'text-destructive' },
}

const WORKER_STATUS_META: Record<TinyPngWorkerStatus, { label: string; dotClassName: string; className: string }> = {
  idle: { label: '等待首次运行', dotClassName: 'bg-slate-400', className: 'text-muted-foreground' },
  running: { label: '执行中', dotClassName: 'bg-sky-500 animate-pulse', className: 'text-sky-600 dark:text-sky-400' },
  success: { label: '最近运行正常', dotClassName: 'bg-emerald-500', className: 'text-emerald-600 dark:text-emerald-400' },
  partial_failure: { label: '最近部分失败', dotClassName: 'bg-amber-500', className: 'text-amber-600 dark:text-amber-400' },
  skipped: { label: '最近已跳过', dotClassName: 'bg-slate-400', className: 'text-muted-foreground' },
  failed: { label: '最近运行异常', dotClassName: 'bg-red-500', className: 'text-destructive' },
}

const WORKER_REGION_LABELS: Record<string, string> = {
  'aws:ap-southeast-1': '亚太 · 新加坡',
  'aws:us-east-1': '美洲 · 弗吉尼亚',
  'aws:eu-central-1': '欧洲 · 法兰克福',
}

const DEFAULT_EMAIL_DOMAIN_VALUE = '__default__'

function formatTaskTime(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(new Date(value))
}

function formatTaskDuration(durationMs: number): string {
  const totalSeconds = Math.floor(durationMs / 1000)

  if (totalSeconds < 1) return '不足 1 秒'
  if (totalSeconds < 60) return `${totalSeconds} 秒`

  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return seconds > 0 ? `${minutes} 分 ${seconds} 秒` : `${minutes} 分`
}

export function TinyPngPoolStatsCard() {
  const [stats, setStats] = useState<PoolStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  const [emailDomain, setEmailDomain] = useState("")
  const [savingEmailDomain, setSavingEmailDomain] = useState(false)
  const [savingWorkerEmailDomainId, setSavingWorkerEmailDomainId] = useState<string | null>(null)
  const [cronExpression, setCronExpression] = useState("0 * * * *")
  const [savingCronExpression, setSavingCronExpression] = useState(false)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [tokenCount, setTokenCount] = useState(40)
  const [compressionLimit, setCompressionLimit] = useState(10000)
  const [durationDays, setDurationDays] = useState(30)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [generatedPlan, setGeneratedPlan] = useState<GenerateResponse['plan']>(undefined)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [taskLogDialogOpen, setTaskLogDialogOpen] = useState(false)
  const [taskLogTitle, setTaskLogTitle] = useState('TinyPNG Pool 执行日志')
  const [taskLogs, setTaskLogs] = useState<string[]>([])
  const lastTaskLogValueRef = useRef('')
  const router = useRouter()
  const locale = useLocale()
  const tWebsite = useTranslations("profile.website")
  const { toast } = useToast()

  const fetchStats = useCallback(async (showLoading = true) => {
    try {
      if (showLoading) setLoading(true)
      const res = await fetch("/api/admin/tinypng-pool/stats")
      if (!res.ok) throw new Error("获取缓冲池状态失败")
      const data = await res.json() as PoolStats
      setStats(data)
      setEmailDomain(data.emailDomain)
      setCronExpression(data.cronExpression)
      return data
    } catch (error) {
      console.error(error)
      setStats(null)
      return null
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  useEffect(() => {
    if (!running) return

    const refreshTaskLogs = async () => {
      const data = await fetchStats(false)
      const lastRun = data?.taskStatus.lastRun
      if (!lastRun || lastRun.status !== 'running') return

      const nextLogs = lastRun.logs.length > 0 ? lastRun.logs : [lastRun.message]
      const nextValue = nextLogs.join("\n\n")
      if (nextValue !== lastTaskLogValueRef.current) {
        lastTaskLogValueRef.current = nextValue
        setTaskLogs(nextLogs)
      }
    }

    void refreshTaskLogs()
    const timer = window.setInterval(() => {
      void refreshTaskLogs()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [fetchStats, running])

  const handleGenerate = async () => {
    setGenerateLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tinypng/desktop/grants", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "new", tokenCount, compressionLimit, durationDays })
      })
      const data = await res.json() as GenerateResponse
      if (res.ok && data.authLink) {
        setGeneratedLink(data.authLink)
        setGeneratedPlan(data.plan)
        window.dispatchEvent(new CustomEvent('desktop-license-created', { detail: { licenseId: data.licenseId } }))
      } else {
        setError(data.error || "Failed to generate link")
      }
    } catch {
      setError("Network error")
    } finally {
      setGenerateLoading(false)
    }
  }

  const handleCopy = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenDialog = () => {
    setShowDialog(true)
    setGeneratedLink(null)
    setGeneratedPlan(undefined)
    setError(null)
  }

  const handleRunTask = async () => {
    const registrarCount = stats?.workers.filter((worker) => worker.enabled && worker.role === 'registrar').length ?? 0
    const pendingLogs = [
      '正在创建任务记录，日志会自动刷新。',
      `协调节点将先执行一次维护，再向 ${registrarCount} 个区域注册节点派发任务。`,
      '每个区域节点本轮只提交 1 个注册请求，节点之间独立记录结果。',
      '验证邮件、Magic Link、Bearer Token 与 API Key 步骤将在收到邮件后继续写入。',
    ]

    try {
      setRunning(true)
      setTaskLogTitle('正在执行 TinyPNG Pool 任务')
      setTaskLogs(pendingLogs)
      lastTaskLogValueRef.current = pendingLogs.join("\n\n")
      setTaskLogDialogOpen(true)
      const res = await fetch("/api/admin/tinypng-pool/run", { method: "POST" })
      const data = await res.json() as {
        error?: string
        result?: {
          taskRunId: string
          status: Exclude<TinyPngTaskRunStatus, 'running'>
          message: string
          logs: string[]
        }
      }

      if (!res.ok || !data.result) {
        throw new Error(data.error || "任务执行失败")
      }

      toast({
        title: data.result.status === 'skipped' ? '本次任务已跳过' : '任务执行完成',
        description: data.result.message,
        variant: data.result.status === 'failed' ? 'destructive' : 'default',
      })
      setTaskLogTitle('本次 TinyPNG Pool 执行日志')
      const updatedStats = await fetchStats(false)
      const completedLogs = updatedStats?.taskStatus.lastRun?.id === data.result.taskRunId
        ? updatedStats.taskStatus.lastRun.logs
        : undefined
      const nextLogs = completedLogs?.length ? completedLogs : data.result.logs
      setTaskLogs(nextLogs.length > 0 ? nextLogs : [data.result.message])
      lastTaskLogValueRef.current = nextLogs.join("\n\n")
    } catch (error) {
      console.error(error)
      const errorMessage = error instanceof Error ? error.message : "请稍后重试"
      setTaskLogTitle('TinyPNG Pool 任务执行失败')
      setTaskLogs((currentLogs) => [...currentLogs, `任务执行失败：${errorMessage}`])
      toast({
        title: "任务执行失败",
        description: errorMessage,
        variant: "destructive",
      })
    } finally {
      setRunning(false)
    }
  }

  const handleOpenLastTaskLogs = () => {
    const lastRun = stats?.taskStatus.lastRun
    if (!lastRun) return

    const nextLogs = lastRun.logs.length > 0 ? lastRun.logs : [lastRun.message]
    setTaskLogTitle('上次 TinyPNG Pool 完整执行日志')
    setTaskLogs(nextLogs)
    lastTaskLogValueRef.current = nextLogs.join("\n\n")
    setTaskLogDialogOpen(true)
  }

  const handleEmailDomainChange = async (nextEmailDomain: string) => {
    const previousEmailDomain = emailDomain
    setEmailDomain(nextEmailDomain)
    setSavingEmailDomain(true)

    try {
      const res = await fetch("/api/admin/tinypng-pool/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emailDomain: nextEmailDomain }),
      })
      const data = await res.json() as { emailDomain?: string; error?: string }
      if (!res.ok || !data.emailDomain) {
        throw new Error(data.error || "保存邮箱域名失败")
      }

      setEmailDomain(data.emailDomain)
      toast({
        title: "Pool 默认邮箱域名已更新",
        description: `未单独配置的区域节点将使用 @${data.emailDomain}`,
      })
    } catch (error) {
      setEmailDomain(previousEmailDomain)
      toast({
        title: "保存邮箱域名失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSavingEmailDomain(false)
    }
  }

  const handleWorkerEmailDomainChange = async (
    worker: TinyPngWorkerState,
    nextValue: string,
  ) => {
    const nextEmailDomain = nextValue === DEFAULT_EMAIL_DOMAIN_VALUE ? null : nextValue
    const previousStats = stats
    setSavingWorkerEmailDomainId(worker.id)
    setStats((currentStats) => currentStats ? {
      ...currentStats,
      workers: currentStats.workers.map((currentWorker) => currentWorker.id === worker.id
        ? {
            ...currentWorker,
            emailDomain: nextEmailDomain,
          }
        : currentWorker),
    } : currentStats)

    try {
      const res = await fetch("/api/admin/tinypng-pool/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workerId: worker.id, emailDomain: nextEmailDomain }),
      })
      const data = await res.json() as { workerId?: string; error?: string }
      if (!res.ok || data.workerId !== worker.id) {
        throw new Error(data.error || "保存节点邮箱域名失败")
      }

      toast({
        title: `${worker.name} 邮箱域名已更新`,
        description: nextEmailDomain
          ? `后续注册将使用 @${nextEmailDomain}`
          : `后续注册将跟随默认域名 @${emailDomain}`,
      })
    } catch (error) {
      setStats(previousStats)
      toast({
        title: "保存节点邮箱域名失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSavingWorkerEmailDomainId(null)
    }
  }

  const handleSaveCronExpression = async () => {
    const previousCronExpression = stats?.cronExpression ?? "0 * * * *"
    setSavingCronExpression(true)

    try {
      const res = await fetch("/api/admin/tinypng-pool/config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cronExpression }),
      })
      const data = await res.json() as { cronExpression?: string; error?: string }
      if (!res.ok || !data.cronExpression) {
        throw new Error(data.error || "保存定时计划失败")
      }

      setCronExpression(data.cronExpression)
      await fetchStats(false)
      toast({
        title: "定时计划已更新",
        description: `后续将按 ${data.cronExpression}（北京时间）执行`,
      })
    } catch (error) {
      setCronExpression(previousCronExpression)
      toast({
        title: "保存定时计划失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setSavingCronExpression(false)
    }
  }

  if (loading) return null // Or a skeleton

  // Only render if we have stats (implies permission check passed on backend, 
  // though we should also check frontend role ideally, but parent does that or API fails safely)
  if (!stats) return null

  const lastRun = stats.taskStatus.lastRun
  const lastRunMeta = lastRun ? TASK_STATUS_META[lastRun.status] : null
  const enabledWorkers = stats.workers.filter((worker) => worker.enabled)
  const registrarWorkers = enabledWorkers.filter((worker) => worker.role === 'registrar')
  const healthyWorkers = enabledWorkers.filter((worker) => ['success', 'skipped'].includes(worker.status)).length

  return (
    <>
      <div className="bg-background rounded-lg border-2 border-yellow-500/20 p-6">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold text-yellow-500">TinyPNG Pool (Emperor Only)</h2>
          </div>
          <div className="flex flex-wrap gap-2 sm:justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleRunTask}
              disabled={running || loading}
              className="gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? '执行中…' : '立即执行'}
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleOpenDialog}
              className="auth-btn"
            >
              <Link className="w-4 h-4 mr-1" />
              生成桌面授权
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => router.push(`/${locale}/profile/tinypng-pool`)}
              className="auth-btn"
            >
              Details
            </Button>
          </div>
        </div>

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <div className="flex flex-col gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">{tWebsite("tinypngPoolEmailDomain")}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {tWebsite("tinypngPoolEmailDomainDescription")}
              </p>
            </div>
            <Select
              value={emailDomain}
              onValueChange={handleEmailDomainChange}
              disabled={savingEmailDomain || stats.emailDomains.length === 0}
            >
              <SelectTrigger className="w-full sm:w-64">
                <SelectValue placeholder={tWebsite("tinypngPoolEmailDomainPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {stats.emailDomains.map((domain) => (
                  <SelectItem key={domain} value={domain}>
                    @{domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="text-sm font-medium">定时任务 Cron</p>
              <p className="mt-1 text-xs text-muted-foreground">Linux 五段 Cron，按北京时间执行；支持数字、*、,、-、/。</p>
            </div>
            <div className="flex w-full gap-2 sm:w-auto">
              <Input
                value={cronExpression}
                onChange={(event) => setCronExpression(event.target.value)}
                disabled={savingCronExpression || running}
                placeholder="0 * * * *"
                className="w-full font-mono sm:w-48"
                aria-label="TinyPNG Pool 定时任务 Cron 表达式"
              />
              <Button
                variant="outline"
                onClick={handleSaveCronExpression}
                disabled={
                  savingCronExpression
                  || running
                  || !cronExpression.trim()
                  || cronExpression.trim() === stats.cronExpression
                }
              >
                {savingCronExpression ? <Loader2 className="h-4 w-4 animate-spin" /> : '保存'}
              </Button>
            </div>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.025] p-3">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-2">
              <Network className="h-4 w-4 text-yellow-600 dark:text-yellow-400" />
              <p className="text-sm font-medium">Worker 集群</p>
            </div>
            <p className="text-xs text-muted-foreground">
              {enabledWorkers.length} 个启用节点 · {registrarWorkers.length} 个区域注册节点 · {healthyWorkers} 个最近正常
            </p>
          </div>

          <div className="relative mt-3 grid gap-3 md:grid-cols-4" role="list" aria-label="TinyPNG Worker 集群状态">
            <div className="pointer-events-none absolute left-[12.5%] right-[12.5%] top-4 hidden h-px bg-yellow-500/25 md:block" />
            {stats.workers.map((worker) => {
              const statusMeta = worker.enabled
                ? WORKER_STATUS_META[worker.status]
                : { label: '已停用', dotClassName: 'bg-slate-300', className: 'text-muted-foreground' }
              const regionLabel = worker.configuredRegion
                ? WORKER_REGION_LABELS[worker.configuredRegion] ?? worker.configuredRegion
                : 'Cloudflare Cron'

              return (
                <div
                  key={worker.id}
                  role="listitem"
                  className={`relative z-10 min-w-0 rounded-lg border p-3 ${
                    worker.role === 'coordinator'
                      ? 'border-yellow-500/30 bg-background'
                      : 'border-border/70 bg-background/90'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-background ${statusMeta.dotClassName}`} />
                      <p className="truncate text-sm font-medium">{worker.name}</p>
                    </div>
                    {worker.role === 'coordinator'
                      ? <Wrench className="h-3.5 w-3.5 shrink-0 text-yellow-600 dark:text-yellow-400" />
                      : <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    <span className="rounded border border-border/70 px-1.5 py-0.5 text-[10px] text-muted-foreground">
                      {worker.role === 'coordinator' ? '维护 · 调度' : '区域注册'}
                    </span>
                    {worker.maintenanceOwner ? (
                      <span className="rounded border border-yellow-500/30 bg-yellow-500/10 px-1.5 py-0.5 text-[10px] text-yellow-700 dark:text-yellow-300">
                        唯一清理节点
                      </span>
                    ) : null}
                  </div>
                  {worker.role === 'registrar' ? (
                    <div className="mt-3">
                      <p className="mb-1 text-[10px] text-muted-foreground">注册邮箱域名</p>
                      <Select
                        value={worker.emailDomain || DEFAULT_EMAIL_DOMAIN_VALUE}
                        onValueChange={(value) => handleWorkerEmailDomainChange(worker, value)}
                        disabled={savingWorkerEmailDomainId === worker.id || stats.emailDomains.length === 0}
                      >
                        <SelectTrigger
                          className="h-8 w-full px-2 text-xs"
                          aria-label={`${worker.name}注册邮箱域名`}
                        >
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={DEFAULT_EMAIL_DOMAIN_VALUE}>
                            跟随默认 · @{emailDomain}
                          </SelectItem>
                          {stats.emailDomains.map((domain) => (
                            <SelectItem key={domain} value={domain}>
                              @{domain}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : null}
                  <div className="mt-3 space-y-1.5 text-xs">
                    <div className="flex items-center gap-1.5 text-muted-foreground">
                      <MapPin className="h-3 w-3 shrink-0" />
                      <span className="truncate font-mono">{regionLabel}</span>
                    </div>
                    <div className={`flex items-center gap-1.5 ${statusMeta.className}`}>
                      <Activity className="h-3 w-3 shrink-0" />
                      <span>{statusMeta.label}</span>
                    </div>
                  </div>
                  <div className="mt-3 border-t border-border/60 pt-2 text-[11px] text-muted-foreground">
                    <p className="truncate font-mono">
                      {worker.actualPlacement || '等待上报实际位置'}
                    </p>
                    <p className="mt-1">
                      {worker.lastRunAt ? `最近 ${formatTaskTime(worker.lastRunAt)}` : '暂无执行记录'}
                      {worker.lastRun && worker.role === 'registrar'
                        ? ` · ${worker.lastRun.successfulCount}/${worker.lastRun.createdCount}`
                        : ''}
                    </p>
                  </div>
                </div>
              )
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <div className="p-3 bg-secondary/20 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="p-3 bg-green-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
              <div className="text-xs text-muted-foreground">Active</div>
          </div>
          <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.used}</div>
              <div className="text-xs text-muted-foreground">Used</div>
          </div>
          <div className="rounded-lg bg-violet-500/10 p-3 text-center">
              <div className="text-2xl font-bold text-violet-600">{stats.reserved}</div>
              <div className="text-xs text-muted-foreground">Reserved</div>
          </div>
          <div className="rounded-lg bg-indigo-500/10 p-3 text-center">
              <div className="text-2xl font-bold text-indigo-600">{stats.assigned}</div>
              <div className="text-xs text-muted-foreground">Assigned</div>
          </div>
        </div>

        <div className="mt-4 grid overflow-hidden rounded-lg border border-yellow-500/20 bg-yellow-500/[0.025] sm:grid-cols-2">
          <div className="flex min-w-0 items-start gap-3 border-b border-yellow-500/15 px-4 py-3 sm:border-b-0 sm:border-r">
            <History className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground">上一轮集群任务</p>
              <p className={`mt-0.5 text-sm font-medium ${lastRunMeta?.className ?? 'text-muted-foreground'}`}>
                {lastRunMeta ? lastRunMeta.label : '暂无执行记录'}
              </p>
              {lastRun ? (
                <>
                  <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                    <div>
                      <p className="text-muted-foreground">执行时间</p>
                      <p className="mt-0.5 font-medium">{formatTaskTime(lastRun.completedAt)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">耗时</p>
                      <p className="mt-0.5 font-medium">{formatTaskDuration(lastRun.durationMs)}</p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">成功账号</p>
                      <p className="mt-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                        {lastRun.successfulCount} 个
                      </p>
                    </div>
                    <div>
                      <p className="text-muted-foreground">注册成功率</p>
                      <p className="mt-0.5 font-medium text-emerald-600 dark:text-emerald-400">
                        {lastRun.successRate === null ? '—' : `${lastRun.successRate}%`}
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenLastTaskLogs}
                    className="mt-3 h-8 gap-1.5 text-xs"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                    查看全部节点日志
                  </Button>
                </>
              ) : null}
            </div>
          </div>
          <div className="flex min-w-0 items-start gap-3 px-4 py-3">
            <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-yellow-600 dark:text-yellow-400" />
            <div>
              <p className="text-xs text-muted-foreground">下一次计划</p>
              <p className="mt-0.5 text-sm font-medium">
                {formatTaskTime(stats.taskStatus.nextRunAt)}
              </p>
              <p className="mt-0.5 text-xs text-muted-foreground">
                {stats.taskStatus.scheduleLabel}
              </p>
            </div>
          </div>
        </div>
      </div>

      <Dialog open={taskLogDialogOpen} onOpenChange={setTaskLogDialogOpen}>
        <DialogContent className="max-h-[85vh] sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {running ? <Loader2 className="h-4 w-4 animate-spin text-sky-600" /> : <ScrollText className="h-4 w-4 text-yellow-600" />}
              {taskLogTitle}
            </DialogTitle>
            <DialogDescription>
              {running
                ? '日志每 2 秒自动刷新；验证邮件到达后会继续显示 Token 与 API Key 获取步骤。'
                : '已隐藏 Magic Link、Token、Bearer Token 与 API Key 的敏感内容。'}
            </DialogDescription>
          </DialogHeader>
          <pre className="max-h-[58vh] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-yellow-500/20 bg-muted/30 p-4 font-mono text-xs leading-6 text-foreground">
            {taskLogs.length > 0 ? taskLogs.join("\n\n") : '暂无执行日志。'}
          </pre>
        </DialogContent>
      </Dialog>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>生成“智能压缩工具”授权链接</DialogTitle>
            <DialogDescription>
              Token 数量、压缩额度和授权有效期均写入本次 Auth Link；链接 24 小时内有效且只能兑换一次。
            </DialogDescription>
          </DialogHeader>
          
          {!generatedLink ? (
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="desktopTokenCount">Token 数量</Label>
                  <Input id="desktopTokenCount" type="number" min={1} max={200} value={tokenCount} onChange={(event) => setTokenCount(Number(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desktopCompressionLimit">可压缩张数</Label>
                  <Input id="desktopCompressionLimit" type="number" min={1} max={1000000} value={compressionLimit} onChange={(event) => setCompressionLimit(Number(event.target.value))} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="desktopDurationDays">有效天数</Label>
                  <Input id="desktopDurationDays" type="number" min={1} max={365} value={durationDays} onChange={(event) => setDurationDays(Number(event.target.value))} />
                </div>
              </div>
              <p className="text-xs text-muted-foreground">生成链接时将原子预留 {Number.isFinite(tokenCount) ? tokenCount : 0} 个 Token；兑换后创建对应额度与时长的授权周期。</p>
              
              {error && (
                <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded-lg">
                  {error}
                </div>
              )}
              
              <Button 
                onClick={handleGenerate} 
                disabled={generateLoading || !Number.isInteger(tokenCount) || tokenCount < 1 || tokenCount > 200 || !Number.isInteger(compressionLimit) || compressionLimit < 1 || compressionLimit > 1000000 || !Number.isInteger(durationDays) || durationDays < 1 || durationDays > 365}
                className="w-full"
              >
                {generateLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    生成中…
                  </>
                ) : (
                  "生成授权链接"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>授权链接</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={generatedLink}
                    className="font-mono text-xs"
                  />
                  <Button size="icon" variant="outline" onClick={handleCopy}>
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  此链接将在 24 小时后失效，且只能兑换一次。
                </p>
                {generatedPlan ? (
                  <p className="rounded-md border bg-muted/30 px-3 py-2 text-xs text-muted-foreground">
                    {generatedPlan.tokenCount} Token · {generatedPlan.compressionLimit.toLocaleString()} 张 · 激活后 {generatedPlan.durationDays} 天有效
                  </p>
                ) : null}
              </div>
              
              <Button 
                variant="outline"
                onClick={() => setGeneratedLink(null)}
                className="w-full"
              >
                再生成一个
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
