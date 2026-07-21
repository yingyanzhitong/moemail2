import { getVersion } from '@tauri-apps/api/app'
import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Progress } from '@/components/ui/progress'

type UpdateStatus = 'idle' | 'checking' | 'available' | 'notAvailable' | 'downloading' | 'installing' | 'installed' | 'error'

interface UpdateProgress {
  downloadedBytes: number
  totalBytes: number | null
}

const checkTimeoutMs = 30_000
const checkIntervalMs = 60 * 60 * 1000

export function UpdateButton() {
  const [status, setStatus] = useState<UpdateStatus>('idle')
  const [pendingUpdate, setPendingUpdate] = useState<Update | null>(null)
  const [dialogOpen, setDialogOpen] = useState(false)
  const [currentVersion, setCurrentVersion] = useState('')
  const [message, setMessage] = useState('')
  const [progress, setProgress] = useState<UpdateProgress>({ downloadedBytes: 0, totalBytes: null })
  const checkingRef = useRef(false)
  const installingRef = useRef(false)
  const pendingUpdateRef = useRef<Update | null>(null)

  useEffect(() => {
    pendingUpdateRef.current = pendingUpdate
  }, [pendingUpdate])

  useEffect(() => {
    if (!isTauri()) return
    void getVersion().then(setCurrentVersion).catch(() => setCurrentVersion(''))
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let cancelled = false
    const runCheck = () => {
      if (!cancelled) void checkForUpdates()
    }
    runCheck()
    const intervalId = window.setInterval(runCheck, checkIntervalMs)
    return () => {
      cancelled = true
      window.clearInterval(intervalId)
    }
  }, [])

  async function checkForUpdates() {
    if (!isTauri() || checkingRef.current || installingRef.current || pendingUpdateRef.current) return
    checkingRef.current = true
    setStatus('checking')
    setMessage('')
    setProgress({ downloadedBytes: 0, totalBytes: null })

    try {
      const latest = await check({ timeout: checkTimeoutMs })
      setPendingUpdate(latest)
      if (latest) {
        setStatus('available')
        setMessage(`发现新版本 ${latest.version}`)
      } else {
        setStatus('notAvailable')
        setMessage('')
      }
    } catch {
      setPendingUpdate(null)
      setStatus('idle')
      setMessage('')
    } finally {
      checkingRef.current = false
    }
  }

  async function installUpdate() {
    if (!pendingUpdate || installingRef.current) return
    installingRef.current = true
    setStatus('downloading')
    setMessage('正在下载已签名更新包。')
    setProgress({ downloadedBytes: 0, totalBytes: null })

    let downloadedBytes = 0
    let totalBytes: number | null = null
    try {
      await pendingUpdate.downloadAndInstall((event: DownloadEvent) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? null
          setProgress({ downloadedBytes: 0, totalBytes })
          return
        }
        if (event.event === 'Progress') {
          downloadedBytes += event.data.chunkLength
          setProgress({ downloadedBytes, totalBytes })
          return
        }
        setStatus('installing')
        setMessage('更新已下载，正在安装。')
      })
      setStatus('installed')
      setMessage('更新已安装，正在重新启动。')
      await relaunch()
    } catch (error) {
      setStatus('error')
      setMessage(formatUpdateError(error))
    } finally {
      installingRef.current = false
    }
  }

  function openUpdateDialog() {
    setDialogOpen(true)
  }

  const isInstalling = status === 'downloading' || status === 'installing'
  const progressPercent = getProgressPercent(progress)
  const latestVersion = pendingUpdate?.version ?? '-'
  const notes = pendingUpdate?.body?.trim()
  const label = buttonLabel(status, pendingUpdate, progress)
  const visibleLabel = status === 'available' ? '更新' : label

  if (!pendingUpdate && !['downloading', 'installing', 'installed', 'error'].includes(status)) return null

  return (
    <>
      <Button
        aria-label={label}
        className={status === 'error' ? 'h-6 max-w-[7rem] rounded-[6px] border border-[#C53D47] bg-[#C53D47] px-2.5 text-[11px] font-semibold leading-none text-white shadow-none hover:bg-[#AA333C]' : 'h-6 max-w-[7rem] rounded-[6px] border border-[#2956D8] bg-[#2956D8] px-2.5 text-[11px] font-semibold leading-none text-white shadow-none hover:bg-[#2148B7]'}
        onClick={openUpdateDialog}
        size="sm"
        title={message || `发现 ${pendingUpdate?.version ?? '新版本'}，打开更新详情`}
        type="button"
        variant={status === 'error' ? 'danger' : 'default'}
      >
        <UpdateIcon status={status} />
        <span className="min-w-0 truncate">{visibleLabel}</span>
      </Button>

      <Dialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open && isInstalling) return
          setDialogOpen(open)
        }}
      >
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <div className="flex min-w-0 items-center gap-2">
              <DialogTitle className="min-w-0 truncate">应用更新</DialogTitle>
              <UpdateBadge status={status} />
            </div>
            <DialogDescription>更新包来自 Gitee Release，并由 Tauri 签名校验后安装。</DialogDescription>
          </DialogHeader>

          <div className="mt-5 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <VersionCard label="当前版本" value={currentVersion || '-'} />
              <VersionCard label="最新版本" value={latestVersion} />
            </div>

            {notes ? (
              <div className="rounded-[8px] border border-[#D6DDE8] bg-[#F7F9FC] px-3 py-2.5">
                <p className="text-[11px] font-semibold text-[#667085]">更新说明</p>
                <p className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap text-xs leading-5 text-[#42506A]">{notes}</p>
              </div>
            ) : null}

            {isInstalling ? (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-3 text-xs text-[#667085]">
                  <span>{status === 'installing' ? '正在安装' : '正在下载'}</span>
                  <span className="font-mono tabular-nums">{progressPercent === null ? formatBytes(progress.downloadedBytes) : `${progressPercent}%`}</span>
                </div>
                <Progress value={progressPercent ?? 36} />
                <p className="text-[11px] text-[#667085]">{progress.totalBytes ? `${formatBytes(progress.downloadedBytes)} / ${formatBytes(progress.totalBytes)}` : '等待服务器返回文件大小'}</p>
              </div>
            ) : null}

            {message ? <p className={status === 'error' ? 'rounded-[8px] border border-[#F1C5C7] bg-[#FFF5F5] px-3 py-2 text-xs leading-5 text-[#B4232B]' : 'rounded-[8px] border border-[#D6DDE8] bg-white px-3 py-2 text-xs leading-5 text-[#667085]'}>{message}</p> : null}

            <p className="rounded-[8px] border border-[#D6DDE8] bg-[#F7F9FC] px-3 py-2 text-[11px] leading-5 text-[#667085]">更新清单：<span className="font-mono">Gitee release/latest.json</span></p>

            <div className="flex justify-end gap-2 pt-1">
              <Button disabled={isInstalling} onClick={() => setDialogOpen(false)} type="button" variant="outline">关闭</Button>
              <Button disabled={isInstalling || status === 'checking' || status === 'installed'} onClick={() => void (pendingUpdate ? installUpdate() : checkForUpdates())} type="button">
                {primaryActionLabel(status, pendingUpdate)}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}

function VersionCard({ label, value }: { label: string; value: string }) {
  return <div className="rounded-[8px] border border-[#D6DDE8] bg-[#F7F9FC] px-3 py-2"><p className="text-[11px] text-[#667085]">{label}</p><p className="mt-1 truncate font-mono text-sm font-semibold text-[#172033]">{value}</p></div>
}

function UpdateIcon({ status }: { status: UpdateStatus }) {
  if (status === 'checking' || status === 'downloading') return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (status === 'available') return <Download className="h-3.5 w-3.5" />
  if (status === 'notAvailable' || status === 'installed') return <CheckCircle2 className="h-3.5 w-3.5" />
  if (status === 'error') return <AlertTriangle className="h-3.5 w-3.5" />
  return <RefreshCw className="h-3.5 w-3.5" />
}

function UpdateBadge({ status }: { status: UpdateStatus }) {
  const variant = status === 'available' || status === 'downloading' || status === 'installing'
    ? 'border-[#BFD0FF] bg-[#EDF2FF] text-[#2956D8]'
    : status === 'notAvailable' || status === 'installed'
      ? 'border-[#B8E0D6] bg-[#EFFAF6] text-[#15806A]'
      : status === 'error'
        ? 'border-[#F1C5C7] bg-[#FFF5F5] text-[#B4232B]'
        : 'border-[#D6DDE8] bg-[#F7F9FC] text-[#667085]'
  return <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium ${variant}`}>{badgeLabel(status)}</span>
}

function buttonLabel(status: UpdateStatus, update: Update | null, progress: UpdateProgress) {
  const progressPercent = getProgressPercent(progress)
  if (status === 'checking') return '检查中'
  if (status === 'available') return `新版本 ${update?.version ?? ''}`.trim()
  if (status === 'downloading') return progressPercent === null ? '下载中' : `下载 ${progressPercent}%`
  if (status === 'installing') return '安装中'
  if (status === 'installed') return '重启中'
  if (status === 'notAvailable') return '已是最新'
  if (status === 'error') return '更新失败'
  return '检查更新'
}

function badgeLabel(status: UpdateStatus) {
  if (status === 'available') return '有新版本'
  if (status === 'checking') return '检查中'
  if (status === 'downloading') return '下载中'
  if (status === 'installing') return '安装中'
  if (status === 'installed') return '已安装'
  if (status === 'notAvailable') return '最新'
  if (status === 'error') return '失败'
  return '待检查'
}

function primaryActionLabel(status: UpdateStatus, update: Update | null) {
  if (status === 'checking') return '检查中'
  if (status === 'downloading') return '下载中'
  if (status === 'installing') return '安装中'
  if (status === 'installed') return '正在重启'
  return update ? '立即更新' : '重新检查'
}

function getProgressPercent(progress: UpdateProgress) {
  if (!progress.totalBytes || progress.totalBytes <= 0) return null
  return Math.min(100, Math.max(0, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)))
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function formatUpdateError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  if (/404|not found/i.test(raw)) return '未找到更新清单，请稍后重试。'
  if (/signature|pubkey|verify/i.test(raw)) return '更新签名校验失败，已停止安装。'
  if (/network|fetch|timeout|timed out/i.test(raw)) return '连接更新源失败，请检查网络后重试。'
  return raw || '检查更新失败。'
}
