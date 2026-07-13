import { useCallback, useEffect, useMemo, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { isTauri } from '@tauri-apps/api/core'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { Aperture, Loader2, Pause, Play, WifiOff } from 'lucide-react'
import { ActivationDialog } from '@/components/activation-dialog'
import { DropZone } from '@/components/drop-zone'
import { FileQueue } from '@/components/file-queue'
import { LicensePanel } from '@/components/license-panel'
import { Button } from '@/components/ui/button'
import { addDroppedPaths, bootstrap, cancelCompression, pickFolder, pickImages, redeem, refreshLicense, startCompression, takeActivationCode } from '@/lib/desktop-api'
import type { CompressionProgress, ImageJob, LicenseView, QueueItem } from '@/types'

const emptyLicense: LicenseView = { id: null, status: 'unlicensed', used: 0, limit: 10000, startsAt: null, expiresAt: null, scheduledPeriods: [] }

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
  const [license, setLicense] = useState<LicenseView>(emptyLicense)
  const [queue, setQueue] = useState<QueueItem[]>([])
  const [booting, setBooting] = useState(true)
  const [running, setRunning] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [dropActive, setDropActive] = useState(false)
  const [activationOpen, setActivationOpen] = useState(false)
  const [activationCode, setActivationCode] = useState('')
  const [notice, setNotice] = useState<string | null>(null)

  const mergeJobs = useCallback((jobs: ImageJob[]) => {
    setQueue((current) => {
      const existingPaths = new Set(current.map((item) => item.sourcePath))
      return [...current, ...jobs.filter((job) => !existingPaths.has(job.sourcePath)).map((job) => ({ ...job, status: 'queued' as const }))]
    })
  }, [])

  useEffect(() => {
    void bootstrap()
      .then((view) => {
        setLicense(view.license)
        if (view.reconciledReservations > 0) setNotice(`已恢复并结算 ${view.reconciledReservations} 个中断批次。`)
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
        setQueue((current) => current.map((item) => item.id === event.payload.id ? { ...item, ...event.payload } : item))
      }),
      getCurrentWebviewWindow().onDragDropEvent((event) => {
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

  const doRedeem = async (code: string) => {
    try {
      const next = await redeem(code)
      setLicense(next)
      setActivationCode('')
      setNotice('授权已更新，可以开始新的压缩批次。')
    } catch (error) {
      throw new Error(messageFromError(error))
    }
  }

  const start = async () => {
    setRunning(true)
    setNotice(null)
    setQueue((current) => current.map((item) => queuedIds.includes(item.id) ? { ...item, status: 'queued', error: undefined } : item))
    try {
      const summary = await startCompression(queuedIds)
      setLicense(summary.license)
      setNotice(`本次完成 ${summary.completed} 张，失败 ${summary.failed} 张，跳过 ${summary.skipped} 张。`)
    } catch (error) {
      setNotice(messageFromError(error))
    } finally {
      setRunning(false)
    }
  }

  const cancel = async () => {
    await cancelCompression()
    setNotice('已请求取消：进行中的最多 4 张会完成并正常结算。')
  }

  if (booting) {
    return <main className="flex min-h-screen items-center justify-center bg-[#F3F6FA] text-[#42506A]"><Loader2 className="mr-3 h-5 w-5 animate-spin text-[#2956D8]" />正在校验授权并恢复任务…</main>
  }

  return (
    <main className="min-h-screen bg-[#F3F6FA] text-[#172033]">
      <header className="flex h-16 items-center justify-between border-b border-[#D6DDE8] bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#172033] text-white"><Aperture className="h-5 w-5" /></div>
          <div><h1 className="text-sm font-semibold">智能压缩工具</h1><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8792A5]">Imaging calibration desk</p></div>
        </div>
        <div className="flex items-center gap-3">
          {license.status === 'offline' ? <span className="flex items-center gap-1.5 text-xs text-[#C53D47]"><WifiOff className="h-3.5 w-3.5" />离线</span> : null}
          {running ? (
            <Button variant="danger" onClick={() => void cancel()}><Pause className="h-4 w-4" />取消任务</Button>
          ) : (
            <Button onClick={() => void start()} disabled={!canStart} title={license.status !== 'active' ? '需要有效授权才能开始新批次' : queuedIds.length === 0 ? '请先添加图片' : undefined}><Play className="h-4 w-4 fill-current" />开始压缩</Button>
          )}
        </div>
      </header>

      <div className="grid h-[calc(100vh-64px)] min-h-[576px] grid-cols-[minmax(0,1fr)_300px] gap-5 p-5">
        <div className="flex min-w-0 flex-col gap-4">
          <DropZone active={dropActive} disabled={running} onPickImages={() => void pickImages().then(mergeJobs).catch((error) => setNotice(messageFromError(error)))} onPickFolder={() => void pickFolder().then(mergeJobs).catch((error) => setNotice(messageFromError(error)))} />
          {notice ? <div role="status" className="flex items-center justify-between rounded-[8px] border border-[#CBD5E2] bg-white px-3 py-2 text-xs text-[#526078]"><span>{notice}</span><button className="ml-4 text-[#2956D8] hover:underline" onClick={() => setNotice(null)}>关闭</button></div> : null}
          <FileQueue items={queue} running={running} onRemove={(id) => setQueue((current) => current.filter((item) => item.id !== id))} onClear={() => setQueue([])} />
        </div>
        <LicensePanel license={license} refreshing={refreshing} onRefresh={() => void doRefresh()} onActivate={() => setActivationOpen(true)} />
      </div>

      <ActivationDialog open={activationOpen} initialCode={activationCode} onOpenChange={setActivationOpen} onRedeem={doRedeem} />
    </main>
  )
}
