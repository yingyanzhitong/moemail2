"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Database, Link, Copy, Check, Loader2, Clock3, History, Play, ScrollText } from "lucide-react"
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
  taskStatus: TinyPngTaskStatus
}

interface GenerateResponse {
  success: boolean
  authLink?: string
  expiresAt?: string
  code?: string
  error?: string
}

const TASK_STATUS_META: Record<TinyPngTaskRunStatus, { label: string; className: string }> = {
  running: { label: '执行中', className: 'text-sky-600 dark:text-sky-400' },
  success: { label: '执行成功', className: 'text-emerald-600 dark:text-emerald-400' },
  partial_failure: { label: '部分失败', className: 'text-amber-600 dark:text-amber-400' },
  skipped: { label: '本次跳过', className: 'text-muted-foreground' },
  failed: { label: '执行失败', className: 'text-destructive' },
}

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
  const [generateLoading, setGenerateLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
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
        body: JSON.stringify({ kind: "new" })
      })
      const data = await res.json() as GenerateResponse
      if (res.ok && data.authLink) {
        setGeneratedLink(data.authLink)
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
    setError(null)
  }

  const handleRunTask = async () => {
    const pendingLogs = [
      '正在创建任务记录，日志会自动刷新。',
      '本批次包含 5 个账号，相邻注册间隔 1 分钟。',
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
        title: "Pool 邮箱域名已更新",
        description: `后续注册将使用 @${data.emailDomain}`,
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

  if (loading) return null // Or a skeleton

  // Only render if we have stats (implies permission check passed on backend, 
  // though we should also check frontend role ideally, but parent does that or API fails safely)
  if (!stats) return null

  const lastRun = stats.taskStatus.lastRun
  const lastRunMeta = lastRun ? TASK_STATUS_META[lastRun.status] : null

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

        <div className="mb-4 flex flex-col gap-3 rounded-lg border border-yellow-500/20 bg-yellow-500/[0.025] p-3 sm:flex-row sm:items-center sm:justify-between">
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
              <p className="text-xs text-muted-foreground">上次任务</p>
              <p className={`mt-0.5 text-sm font-medium ${lastRunMeta?.className ?? 'text-muted-foreground'}`}>
                {lastRunMeta ? lastRunMeta.label : '暂无执行记录'}
              </p>
              {lastRun ? (
                <>
                  <div className="mt-2 grid grid-cols-3 gap-3 text-xs">
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
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={handleOpenLastTaskLogs}
                    className="mt-3 h-8 gap-1.5 text-xs"
                  >
                    <ScrollText className="h-3.5 w-3.5" />
                    查看完整执行日志
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
              新授权固定包含 30 天、10,000 张逻辑额度，并原子预留 40 个 TinyPNG Key。链接 24 小时内有效。
            </DialogDescription>
          </DialogHeader>
          
          {!generatedLink ? (
            <div className="space-y-4">
              <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                <p className="font-medium">标准授权</p>
                <p className="mt-1 text-muted-foreground">30 天 · 10,000 张 · 首次绑定一台设备</p>
              </div>
              
              {error && (
                <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded-lg">
                  {error}
                </div>
              )}
              
              <Button 
                onClick={handleGenerate} 
                disabled={generateLoading}
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
