import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Aperture, Loader2, Pause, Play } from 'lucide-react'
import { ActivationDialog } from '@/components/activation-dialog'
import { ActivationScreen } from '@/components/activation-screen'
import { DropZone } from '@/components/drop-zone'
import { FileQueue } from '@/components/file-queue'
import { LicensePanel } from '@/components/license-panel'
import { OverwriteConfirmDialog } from '@/components/overwrite-confirm-dialog'
import { Button } from '@/components/ui/button'
import { addDroppedPaths, bootstrap, cancelCompression, loadThumbnails, pickFolder, pickImages, previewActivation, redeem, refreshLicense, startCompression, takeActivationCode } from '@/lib/desktop-api'
import type { CompressionProgress, ImageJob, LicenseView, OutputMode, QueueItem, ThumbnailReady } from '@/types'

const emptyLicense: LicenseView = { id: null, status: 'unlicensed', used: 0, limit: 0, tokenCount: 0, startsAt: null, expiresAt: null, scheduledPeriods: [] }

function messageFromError(error: unknown) {
  const value = error instanceof Error ? error.message : String(error)
  try {
    const parsed = JSON.parse(value) as { message?: string }
    return parsed.message ?? value
  } catch {
    return value
  }
}

function applyProgress(current: QueueItem[], progress: CompressionProgress) {
  const index = current.findIndex((item) => item.id === progress.id)
  if (index === -1) return current
  const next = current.slice()
  next[index] = { ...next[index], ...progress }
  return next
}

export function App() {
  const [license, setLicense] = useState<LicenseView>(emptyLicense)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [booting, setBooting] = useState(true)
  const [running, setRunning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [activationOpen, setActivationOpen] = useState(false)
  const [activationCode, setActivationCode] = useState('')
  const [outputMode, setOutputMode] = useState<OutputMode>('new_folder')
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const licenseIdRef = useRef<string | null>(null)
  const thumbnailCacheRef = useRef(new Map<string, string>())
  licenseIdRef.current = license.id

  const mergeJobs = useCallback((jobs: ImageJob[]) => {
    setQueue((current) => {
      const existingPaths = new Set(current.map((item) => item.sourcePath))
      return [...current, ...jobs.filter((job) => !existingPaths.has(job.sourcePath)).map((job) => ({
        ...job,
        thumbnailDataUrl: thumbnailCacheRef.current.get(job.id) ?? job.thumbnailDataUrl,
        status: 'queued' as const,
      }))]
    })
    if (jobs.length > 0) {
      void loadThumbnails(jobs.map((job) => job.id)).catch((error) => setNotice(messageFromError(error)))
    }
  }, [])

  useEffect(() => {
    void bootstrap()
      .then((view) => {
        setLicense(view.license)
        if (view.pendingUsageReports > 0) {
          setNotice(`有 ${view.pendingUsageReports} 个使用记录待联网回传，将在下次压缩时继续同步。`)
        } else if (view.reconciledReservations > 0) {
          setNotice(`检测到 ${view.reconciledReservations} 个中断批次，已按安全策略计入本地额度并完成回传。`)
        }
      })
      .catch((error) => setNotice(messageFromError(error)))
      .finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    if (!isTauri()) return
    let mounted = true
    const unlisteners = Promise.all([
      listen<string>('activation-code', (event) => {
        setActivationCode(event.payload)
        setActivationOpen(true)
      }),
      listen<CompressionProgress>('compression-progress', (event) => {
        setQueue((current) => applyProgress(current, event.payload))
      }),
      listen<ThumbnailReady>('thumbnail-ready', (event) => {
        thumbnailCacheRef.current.set(event.payload.id, event.payload.thumbnailDataUrl)
        setQueue((current) => {
          const index = current.findIndex((item) => item.id === event.payload.id)
          if (index === -1) return current
          const next = current.slice()
          next[index] = { ...next[index], thumbnailDataUrl: event.payload.thumbnailDataUrl }
          return next
        })
      }),
      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (licenseIdRef.current === null) return
        if (event.payload.type === 'enter' || event.payload.type === 'over') setDropActive(true)
        if (event.payload.type === 'leave') setDropActive(false)
        if (event.payload.type === 'drop') {
          setDropActive(false)
          void addDroppedPaths(event.payload.paths).then(mergeJobs).catch((error) => setNotice(messageFromError(error)))
        }
      }),
    ])
    void unlisteners
      .then(() => takeActivationCode())
      .then((code) => {
        if (mounted && code) {
          setActivationCode(code)
          setActivationOpen(true)
        }
      })
      .catch((error) => {
        if (mounted) setNotice(messageFromError(error))
      })
    return () => {
      mounted = false
      void unlisteners.then((items) => items.forEach((unlisten) => unlisten()))
    }
  }, [mergeJobs])

  const queuedIds = useMemo(() => queue.filter((item) => item.status === 'queued' || item.status === 'failed' || item.status === 'cancelled').map((item) => item.id), [queue])
  const canStart = license.status === 'active' && queuedIds.length > 0 && !running

  const doRefresh = async () => {
    setRefreshing(true)
    try { setLicense(await refreshLicense()) }
    catch (error) { setNotice(messageFromError(error)) }
    finally { setRefreshing(false) }
  }

  const doPreview = useCallback(async (code: string) => {
    try {
      return await previewActivation(code)
    } catch (error) {
      throw new Error(messageFromError(error))
    }
  }, [])

  const doRedeem = async (code: string) => {
    try {
      const next = await redeem(code)
      setLicense(next)
      setActivationCode('')
      setActivationOpen(false)
      setNotice('授权已更新，可以开始新的压缩批次。')
    } catch (error) {
      throw new Error(messageFromError(error))
    }
  }

  const runCompression = async () => {
    setOverwriteConfirmOpen(false)
    setRunning(true)
    setNotice(null)
    const selectedIds = new Set(queuedIds)
    setQueue((current) => current.map((item) => selectedIds.has(item.id) ? { ...item, status: 'queued', stage: null, error: undefined } : item))
    try {
      const summary = await startCompression(queuedIds, outputMode)
      setLicense(summary.license)
      const syncNotice = summary.pendingUsageReports > 0 ? ` ${summary.pendingUsageReports} 个使用记录待联网回传。` : ' 使用情况已回传。'
      setNotice(`本次完成 ${summary.completed} 张，失败 ${summary.failed} 张，跳过 ${summary.skipped} 张。${syncNotice}`)
    } catch (error) {
      setNotice(messageFromError(error))
    } finally {
      setRunning(false)
    }
  }

  const start = () => {
    if (outputMode === 'overwrite') {
      setOverwriteConfirmOpen(true)
      return
    }
    void runCompression()
  }

  const cancel = async () => {
    await cancelCompression()
    setNotice('已请求取消：进行中的最多 4 张会完成并计入本地额度。')
  }

  const removeQueueItem = useCallback((id: string) => {
    setQueue((current) => current.filter((item) => item.id !== id))
  }, [])

  const clearQueue = useCallback(() => setQueue([]), [])

  if (booting) {
    return <main className="flex min-h-screen items-center justify-center bg-[#F3F6FA] text-[#42506A]"><Loader2 className="mr-3 h-5 w-5 animate-spin text-[#2956D8]" />正在校验授权并恢复任务…</main>
  }

  if (license.id === null) {
    return <ActivationScreen initialCode={activationCode} serviceMessage={notice} onPreview={doPreview} onRedeem={doRedeem} />
  }

  return (
    <main className="min-h-screen bg-[#F3F6FA] text-[#172033]">
      <header className="flex h-16 items-center justify-between border-b border-[#D6DDE8] bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#172033] text-white"><Aperture className="h-5 w-5" /></div>
          <div><h1 className="text-sm font-semibold">智能压缩工具</h1><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8792A5]">Imaging calibration desk</p></div>
        </div>
        <div className="flex items-center gap-3">
          {running ? (
            <Button variant="danger" onClick={() => void cancel()}><Pause className="h-4 w-4" />取消任务</Button>
          ) : (
            <Button onClick={start} disabled={!canStart} title={license.status !== 'active' ? '需要有效授权才能开始新批次' : queuedIds.length === 0 ? '请先添加图片' : undefined}><Play className="h-4 w-4 fill-current" />开始压缩</Button>
          )}
        </div>
      </header>

      <div className="grid h-[calc(100vh-64px)] min-h-[576px] grid-cols-[minmax(0,1fr)_300px] gap-5 p-5">
        <div className="flex min-w-0 flex-col gap-4">
          <DropZone active={dropActive} disabled={running} onPickImages={() => void pickImages().then(mergeJobs).catch((error) => setNotice(messageFromError(error)))} onPickFolder={() => void pickFolder().then(mergeJobs).catch((error) => setNotice(messageFromError(error)))} />
          {notice ? <div role="status" className="flex items-center justify-between rounded-[8px] border border-[#CBD5E2] bg-white px-3 py-2 text-xs text-[#526078]"><span>{notice}</span><button className="ml-4 text-[#2956D8] hover:underline" onClick={() => setNotice(null)}>关闭</button></div> : null}
          <FileQueue items={queue} running={running} onRemove={removeQueueItem} onClear={clearQueue} />
        </div>
        <LicensePanel
          license={license}
          refreshing={refreshing}
          onRefresh={() => void doRefresh()}
          onActivate={() => setActivationOpen(true)}
          outputMode={outputMode}
          outputDisabled={running}
          onOutputModeChange={setOutputMode}
        />
      </div>

      <ActivationDialog open={activationOpen} initialCode={activationCode} onOpenChange={setActivationOpen} onRedeem={doRedeem} />
      <OverwriteConfirmDialog
        open={overwriteConfirmOpen}
        imageCount={queuedIds.length}
        onOpenChange={setOverwriteConfirmOpen}
        onConfirm={() => void runCompression()}
      />
    </main>
  )
}
