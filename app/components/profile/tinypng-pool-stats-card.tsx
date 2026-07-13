"use client"

import { useCallback, useEffect, useState } from "react"
import { Database, Link, Copy, Check, Loader2, Clock3, History, Play } from "lucide-react"
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

type TinyPngTaskRunStatus = 'success' | 'partial_failure' | 'skipped' | 'failed'

interface TinyPngTaskStatus {
  scheduleLabel: string
  nextRunAt: string
  lastRun: {
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
  emailDomains: string[]
  emailDomain: string
  taskStatus: TinyPngTaskStatus
}

interface GenerateResponse {
  success: boolean
  authLink?: string
  keyCount?: number
  expiresAt?: string
  code?: string
  error?: string
}

const TASK_STATUS_META: Record<TinyPngTaskRunStatus, { label: string; className: string }> = {
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
  const [keyCount, setKeyCount] = useState(1)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
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
    } catch (error) {
      console.error(error)
      setStats(null)
    } finally {
      if (showLoading) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchStats()
  }, [fetchStats])

  const handleGenerate = async () => {
    setGenerateLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tinypng/electron-auth/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: keyCount })
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
    setKeyCount(1)
  }

  const handleRunTask = async () => {
    try {
      setRunning(true)
      const res = await fetch("/api/admin/tinypng-pool/run", { method: "POST" })
      const data = await res.json() as {
        error?: string
        result?: { status: TinyPngTaskRunStatus; message: string }
      }

      if (!res.ok || !data.result) {
        throw new Error(data.error || "任务执行失败")
      }

      toast({
        title: data.result.status === 'skipped' ? '本次任务已跳过' : '任务执行完成',
        description: data.result.message,
        variant: data.result.status === 'failed' ? 'destructive' : 'default',
      })
      await fetchStats(false)
    } catch (error) {
      console.error(error)
      toast({
        title: "任务执行失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive",
      })
    } finally {
      setRunning(false)
    }
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
              Generate Auth Link
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

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
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
                  <div className="mt-3 border-t border-yellow-500/15 pt-3">
                    <p className="text-xs font-medium text-muted-foreground">完整执行日志</p>
                    <pre className="mt-1 max-h-44 overflow-y-auto whitespace-pre-wrap break-words rounded-md bg-background/70 p-2 font-mono text-[11px] leading-5 text-muted-foreground">
                      {lastRun.logs.length > 0 ? lastRun.logs.join("\n\n") : lastRun.message}
                    </pre>
                  </div>
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

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Authorization Link</DialogTitle>
            <DialogDescription>
              Generate a link to authorize Electron app users with TinyPNG API keys.
            </DialogDescription>
          </DialogHeader>
          
          {!generatedLink ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keyCount">Number of API Keys</Label>
                <Input
                  id="keyCount"
                  type="number"
                  min={1}
                  max={500}
                  value={keyCount}
                  onChange={(e) => setKeyCount(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                />
                <p className="text-xs text-muted-foreground">Max: 500 keys</p>
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
                    Generating...
                  </>
                ) : (
                  "Generate Link"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Authorization Link</Label>
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
                  This link will expire in 24 hours.
                </p>
              </div>
              
              <Button 
                variant="outline"
                onClick={() => setGeneratedLink(null)}
                className="w-full"
              >
                Generate Another
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
