"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ImageIcon, Loader2, Copy, Trash2, RefreshCw, Clock3, History, Play } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useCopy } from "@/hooks/use-copy"
import { useRolePermission } from "@/hooks/use-role-permission"
import { PERMISSIONS } from "@/lib/permissions"

interface TinyPngKey {
  id: string
  apiKey: string
  email: string
  createdAt: string
}

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
  } | null
}

interface TinyPngKeysResponse {
  tinypngKeys: TinyPngKey[]
  taskStatus: TinyPngTaskStatus
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


export function TinyPngKeysPanel() {
  const [keys, setKeys] = useState<TinyPngKey[]>([])
  const [taskStatus, setTaskStatus] = useState<TinyPngTaskStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [running, setRunning] = useState(false)
  const { toast } = useToast()
  const { copyToClipboard } = useCopy()
  const { checkPermission } = useRolePermission()
  const canManageApiKey = checkPermission(PERMISSIONS.MANAGE_API_KEY)
  const canRunTask = checkPermission(PERMISSIONS.MANAGE_CONFIG)

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/tinypng/keys")
      if (!res.ok) throw new Error("获取失败")
      const data = await res.json() as TinyPngKeysResponse
      setKeys(data.tinypngKeys)
      setTaskStatus(data.taskStatus)
    } catch (error) {
      console.error(error)
      toast({
        title: "获取失败",
        description: "无法获取 TinyPNG API Keys",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (canManageApiKey) {
      fetchKeys()
    }
  }, [canManageApiKey, fetchKeys])

  const deleteKey = async (id: string) => {
    try {
      setDeleting(id)
      const res = await fetch("/api/tinypng/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      })

      if (!res.ok) throw new Error("删除失败")

      setKeys(prev => prev.filter(k => k.id !== id))
      toast({
        title: "删除成功",
        description: "TinyPNG API Key 已删除"
      })
    } catch (error) {
      console.error(error)
      toast({
        title: "删除失败",
        description: "无法删除该 Key",
        variant: "destructive"
      })
    } finally {
      setDeleting(null)
    }
  }

  const copyAllKeys = () => {
    const text = keys.map(k => k.apiKey).join("\n")
    copyToClipboard(text)
  }

  const runTaskNow = async () => {
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
      await fetchKeys()
    } catch (error) {
      console.error(error)
      toast({
        title: "任务执行失败",
        description: error instanceof Error ? error.message : "请稍后重试",
        variant: "destructive"
      })
    } finally {
      setRunning(false)
    }
  }

  const lastRun = taskStatus?.lastRun ?? null
  const lastRunMeta = lastRun ? TASK_STATUS_META[lastRun.status] : null

  if (!canManageApiKey) {
    return null
  }

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">TinyPNG API Keys</h2>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          {canRunTask ? (
            <Button
              variant="outline"
              size="sm"
              onClick={runTaskNow}
              disabled={running || loading}
              className="gap-2"
            >
              {running ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              {running ? '执行中…' : '立即执行'}
            </Button>
          ) : null}
          {keys.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={copyAllKeys}
              className="gap-2"
            >
              <Copy className="w-4 h-4" />
              复制全部
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchKeys}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      <div className="grid overflow-hidden rounded-lg border border-primary/15 bg-primary/[0.025] sm:grid-cols-2">
        <div className="flex min-w-0 items-start gap-3 border-b border-primary/10 px-4 py-3 sm:border-b-0 sm:border-r">
          <History className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">上次任务</p>
            <p className={`mt-0.5 text-sm font-medium ${lastRunMeta?.className ?? 'text-muted-foreground'}`}>
              {lastRunMeta ? lastRunMeta.label : loading ? '读取中…' : '暂无执行记录'}
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
                <p className="mt-2 truncate text-xs text-muted-foreground" title={lastRun.message}>
                  {lastRun.message}
                </p>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex min-w-0 items-start gap-3 px-4 py-3">
          <Clock3 className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div>
            <p className="text-xs text-muted-foreground">下一次计划</p>
            <p className="mt-0.5 text-sm font-medium">
              {taskStatus ? formatTaskTime(taskStatus.nextRunAt) : '计算中…'}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {taskStatus?.scheduleLabel ?? '每小时整点'}
            </p>
          </div>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <ImageIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-medium">暂无 TinyPNG API Keys</h3>
              <p className="text-sm text-muted-foreground mt-1">
                点击导航栏的 TinyPNG 按钮批量生成
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground mb-2">
              共 {keys.length} 个 API Key
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                      <div className="font-mono text-sm break-all">
                        {key.apiKey}
                      </div>
                    <div className="text-xs text-muted-foreground">
                      {key.email} · {new Date(key.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(key.apiKey)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteKey(key.id)}
                      disabled={deleting === key.id}
                    >
                      {deleting === key.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
