import { startTransition, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { isTauri } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Aperture, Loader2, Pause, Play } from 'lucide-react'
import { ActivationDialog } from '@/components/activation-dialog'
import { ActivationScreen } from '@/components/activation-screen'
import { DropZone } from '@/components/drop-zone'
import { FileQueue } from '@/components/file-queue'
import { LicensePanel } from '@/components/license-panel'
import { OverwriteConfirmDialog } from '@/components/overwrite-confirm-dialog'
import { Button } from '@/components/ui/button'
import { addDroppedPaths, bootstrap, cancelCompression, pickFolder, pickImages, previewActivation, redeem, refreshLicense, removeJobs, requestThumbnails, startCompression, takeActivationCode } from '@/lib/desktop-api'
import { QueueStore } from '@/lib/queue-store'
import type { CompressionFinished, CompressionProgress, ImageJob, LicenseView, OutputMode, ScanComplete, ThumbnailReady } from '@/types'

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

export function App() {
  const queueStoreRef = useRef<QueueStore | null>(null)
  if (queueStoreRef.current === null) queueStoreRef.current = new QueueStore()
  const queueStore = queueStoreRef.current
  const queue = useSyncExternalStore(queueStore.subscribe, queueStore.getSnapshot, queueStore.getSnapshot)
  const [license, setLicense] = useState<LicenseView>(emptyLicense)
  const [booting, setBooting] = useState(true)
  const [running, setRunning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [activationOpen, setActivationOpen] = useState(false)
  const [activationCode, setActivationCode] = useState('')
  const [outputMode, setOutputMode] = useState<OutputMode>('new_folder')
  const [overwriteConfirmOpen, setOverwriteConfirmOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const licenseIdRef = useRef<string | null>(null)
  licenseIdRef.current = license.id

  const importImages = useCallback(() => {
    setScanning(true)
    void pickImages().catch((error) => {
      setScanning(false)
      setNotice(messageFromError(error))
    })
  }, [])

  const importFolder = useCallback(() => {
    setScanning(true)
    void pickFolder().catch((error) => {
      setScanning(false)
      setNotice(messageFromError(error))
    })
  }, [])

  const requestVisibleThumbnails = useCallback((ids: string[]) => {
    void requestThumbnails(ids).catch((error) => setNotice(messageFromError(error)))
  }, [])

  const doRefresh = useCallback(async () => {
    setRefreshing(true)
    try {
      setLicense(await refreshLicense())
    } catch (error) {
      setNotice(messageFromError(error))
    } finally {
      setRefreshing(false)
    }
  }, [])

  const doPreview = useCallback(async (code: string) => {
    try {
      return await previewActivation(code)
    } catch (error) {
      throw new Error(messageFromError(error))
    }
  }, [])

  const doRedeem = useCallback(async (code: string) => {
    try {
      const next = await redeem(code)
      setLicense(next)
      setActivationCode('')
      setActivationOpen(false)
      setNotice('授权已更新，可以开始新的压缩批次。')
    } catch (error) {
      throw new Error(messageFromError(error))
    }
  }, [])

  const runCompression = useCallback(async () => {
    setOverwriteConfirmOpen(false)
    const ids = queueStore.actionableIds()
    if (ids.length === 0) return
    queueStore.resetPending(ids)
    setRunning(true)
    setNotice(null)
    try {
      const result = await startCompression(ids, outputMode)
      setNotice(`已加入 ${result.acceptedCount} 张图片，正在使用 4 路并发压缩。`)
    } catch (error) {
      setRunning(false)
      setNotice(messageFromError(error))
    }
  }, [outputMode, queueStore])

  const start = useCallback(() => {
    if (outputMode === 'overwrite') {
      setOverwriteConfirmOpen(true)
      return
    }
    void runCompression()
  }, [outputMode, runCompression])

  const cancel = useCallback(async () => {
    await cancelCompression()
    setNotice('已请求取消。已在传输中的图片会安全完成并结算，其余图片保留在队列中。')
  }, [])

  const removeQueueItem = useCallback((id: string) => {
    queueStore.remove([id])
    void removeJobs([id])
  }, [queueStore])

  const clearQueue = useCallback(() => {
    const ids = [...queueStore.getSnapshot().order]
    queueStore.clear()
    void removeJobs(ids)
  }, [queueStore])

  useEffect(() => {
    void bootstrap()
      .then((view) => {
        setLicense(view.license)
      })
      .catch((error) => setNotice(messageFromError(error)))
      .finally(() => setBooting(false))
  }, [])

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable) return
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault()
        start()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [start])

  useEffect(() => {
    if (!isTauri()) return
    let mounted = true
    const unlisteners = Promise.all([
      listen<string>('activation-code', (event) => {
        setActivationCode(event.payload)
        setActivationOpen(true)
      }),
      listen<ImageJob[]>('queue-items-added', (event) => {
        startTransition(() => queueStore.add(event.payload))
      }),
      listen<ScanComplete>('scan-complete', (event) => {
        setScanning(false)
        if (event.payload.discovered === 0) setNotice('没有找到可压缩的图片文件。')
        else if (event.payload.skipped > 0) setNotice(`已加入 ${event.payload.discovered} 张图片，跳过 ${event.payload.skipped} 个不支持或重复项目。`)
      }),
      listen<CompressionProgress>('compression-progress', (event) => {
        startTransition(() => queueStore.applyProgress(event.payload))
      }),
      listen<ThumbnailReady>('thumbnail-ready', (event) => {
        startTransition(() => queueStore.applyThumbnail(event.payload))
      }),
      listen<CompressionFinished>('compression-finished', (event) => {
        setRunning(false)
        if (event.payload.error) {
          setNotice(event.payload.error)
          return
        }
        const summary = event.payload.summary
        if (!summary) return
        setLicense(summary.license)
        setNotice(`本次完成 ${summary.completed} 张，失败 ${summary.failed} 张，跳过 ${summary.skipped} 张。`)
      }),
      listen<string>('workspace-command', (event) => {
        if (event.payload === 'import-images') importImages()
        if (event.payload === 'import-folder') importFolder()
        if (event.payload === 'compress') start()
      }),
      getCurrentWebviewWindow().onDragDropEvent((event) => {
        if (licenseIdRef.current === null) return
        if (event.payload.type === 'enter' || event.payload.type === 'over') setDropActive(true)
        if (event.payload.type === 'leave') setDropActive(false)
        if (event.payload.type === 'drop') {
          setDropActive(false)
          setScanning(true)
          void addDroppedPaths(event.payload.paths).catch((error) => {
            setScanning(false)
            setNotice(messageFromError(error))
          })
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
  }, [importFolder, importImages, queueStore, start])

  const queuedIds = queueStore.actionableIds()
  const canStart = license.status === 'active' && queuedIds.length > 0 && !running && !scanning

  if (booting) return <main className="boot-screen"><Loader2 className="h-4 w-4 animate-spin text-[#0A63C9]" />正在恢复本地工作台…</main>
  if (license.id === null) return <ActivationScreen initialCode={activationCode} serviceMessage={notice} onPreview={doPreview} onRedeem={doRedeem} />

  return (
    <main className="app-window">
      <header className="workspace-toolbar">
        <div className="flex min-w-0 items-center gap-2.5"><div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-[#1D1D1F] text-white"><Aperture className="h-4 w-4" /></div><div className="min-w-0"><h1 className="truncate text-[13px] font-semibold text-[#1D1D1F]">智能压缩工具</h1><p className="text-[10px] text-[#86868B]">图片压缩工作台</p></div></div>
        <div className="flex shrink-0 items-center gap-2">
          {running ? <Button variant="danger" size="sm" onClick={() => void cancel()}><Pause className="h-3.5 w-3.5" />取消</Button> : <Button size="sm" onClick={start} disabled={!canStart} title={license.status !== 'active' ? '需要有效授权才能开始新批次' : scanning ? '正在扫描导入内容' : queuedIds.length === 0 ? '请先导入图片' : undefined}><Play className="h-3.5 w-3.5 fill-current" />开始压缩</Button>}
        </div>
      </header>
      <div className="workspace-layout">
        <section className="workspace-main">
          <DropZone active={dropActive} disabled={running} scanning={scanning} onPickImages={importImages} onPickFolder={importFolder} />
          {notice ? <div role="status" className="workspace-notice"><span>{notice}</span><button type="button" onClick={() => setNotice(null)}>关闭</button></div> : null}
          <FileQueue snapshot={queue} running={running} scanning={scanning} onRemove={removeQueueItem} onClear={clearQueue} onRequestThumbnails={requestVisibleThumbnails} />
        </section>
        <LicensePanel license={license} refreshing={refreshing} onRefresh={() => void doRefresh()} onActivate={() => setActivationOpen(true)} outputMode={outputMode} outputDisabled={running} onOutputModeChange={setOutputMode} />
      </div>
      <ActivationDialog open={activationOpen} initialCode={activationCode} onOpenChange={setActivationOpen} onRedeem={doRedeem} />
      <OverwriteConfirmDialog open={overwriteConfirmOpen} imageCount={queuedIds.length} onOpenChange={setOverwriteConfirmOpen} onConfirm={() => void runCompression()} />
    </main>
  )
}
