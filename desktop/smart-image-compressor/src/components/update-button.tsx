import { isTauri } from '@tauri-apps/api/core'
import { relaunch } from '@tauri-apps/plugin-process'
import { check, type DownloadEvent, type Update } from '@tauri-apps/plugin-updater'
import { AlertTriangle, CheckCircle2, Download, Loader2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/components/ui/button'

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

  const progressPercent = getProgressPercent(progress)
  const label = buttonLabel(status, pendingUpdate, progress)
  const visibleLabel = status === 'available' ? '更新' : label

  if (!pendingUpdate && !['downloading', 'installing', 'installed', 'error'].includes(status)) return null

  return (
    <>
      <Button
        aria-label={label}
        className={status === 'error' ? 'h-6 max-w-[7rem] rounded-[6px] border border-[#C53D47] bg-[#C53D47] px-2.5 text-[11px] font-semibold leading-none text-white shadow-none hover:bg-[#AA333C]' : 'h-6 max-w-[7rem] rounded-[6px] border border-[#2956D8] bg-[#2956D8] px-2.5 text-[11px] font-semibold leading-none text-white shadow-none hover:bg-[#2148B7]'}
        onClick={() => void (pendingUpdate ? installUpdate() : checkForUpdates())}
        size="sm"
        title={message || `发现 ${pendingUpdate?.version ?? '新版本'}，点击后立即下载并安装`}
        type="button"
        variant={status === 'error' ? 'danger' : 'default'}
      >
        <UpdateIcon status={status} />
        <span className="min-w-0 truncate">{visibleLabel}</span>
      </Button>
    </>
  )
}

function UpdateIcon({ status }: { status: UpdateStatus }) {
  if (status === 'checking' || status === 'downloading') return <Loader2 className="h-3.5 w-3.5 animate-spin" />
  if (status === 'available') return <Download className="h-3.5 w-3.5" />
  if (status === 'notAvailable' || status === 'installed') return <CheckCircle2 className="h-3.5 w-3.5" />
  if (status === 'error') return <AlertTriangle className="h-3.5 w-3.5" />
  return <RefreshCw className="h-3.5 w-3.5" />
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

function getProgressPercent(progress: UpdateProgress) {
  if (!progress.totalBytes || progress.totalBytes <= 0) return null
  return Math.min(100, Math.max(0, Math.round((progress.downloadedBytes / progress.totalBytes) * 100)))
}

function formatUpdateError(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error)
  if (/404|not found/i.test(raw)) return '未找到更新清单，请稍后重试。'
  if (/signature|pubkey|verify/i.test(raw)) return '更新签名校验失败，已停止安装。'
  if (/network|fetch|timeout|timed out/i.test(raw)) return '连接更新源失败，请检查网络后重试。'
  return raw || '检查更新失败。'
}
