import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Check, FileImage, FolderOutput, Loader2, MinusCircle, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { QueueSnapshot } from '@/lib/queue-store'
import type { CompressionStage, OutputMode, QueueItem } from '@/types'

const ROW_HEIGHT = 92
const OVERSCAN = 5

const stageLabels: Record<CompressionStage, string> = {
  preparing: '准备中',
  reading: '读取原图',
  uploading: '上传至 TinyPNG',
  downloading: '下载压缩结果',
  writing: '写入文件',
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function queueMetrics(snapshot: QueueSnapshot) {
  let completed = 0
  let failed = 0
  let skipped = 0
  let cancelled = 0
  let compressing = 0
  let completedOriginalSize = 0
  let completedCompressedSize = 0

  for (const id of snapshot.order) {
    const item = snapshot.items.get(id)
    if (!item) continue
    if (item.status === 'completed') {
      completed += 1
      if (typeof item.compressedSize === 'number') {
        completedOriginalSize += item.originalSize
        completedCompressedSize += item.compressedSize
      }
    }
    if (item.status === 'failed') failed += 1
    if (item.status === 'skipped') skipped += 1
    if (item.status === 'cancelled') cancelled += 1
    if (item.status === 'compressing') compressing += 1
  }

  const processed = completed + failed + skipped + cancelled
  const total = snapshot.order.length
  const progressPercent = total === 0 ? 0 : processed / total * 100
  const savedBytes = Math.max(0, completedOriginalSize - completedCompressedSize)
  const savingsPercent = completedOriginalSize === 0 ? null : Math.max(0, savedBytes / completedOriginalSize * 100)
  return { total, completed, failed, skipped, cancelled, compressing, processed, progressPercent, savedBytes, savingsPercent }
}

function StatusIcon({ item }: { item: QueueItem }) {
  if (item.status === 'compressing') return <Loader2 className="h-4 w-4 animate-spin text-[#0A63C9]" />
  if (item.status === 'completed') return <Check className="h-4 w-4 text-[#26845B]" />
  if (item.status === 'failed') return <AlertCircle className="h-4 w-4 text-[#C13C45]" />
  if (item.status === 'skipped' || item.status === 'cancelled') return <MinusCircle className="h-4 w-4 text-[#8A8A8E]" />
  return <span className="h-2 w-2 rounded-full bg-[#B4B4BA]" />
}

function ResultValue({ item }: { item: QueueItem }) {
  if (item.status === 'compressing') return <span className="text-[#0A63C9]">{item.stage ? stageLabels[item.stage] : '处理中'}</span>
  if (item.compressedSize) return <span className="font-mono text-[#343438]">{formatBytes(item.compressedSize)}</span>
  if (item.status === 'failed') return <span className="text-[#C13C45]">失败</span>
  if (item.status === 'skipped') return <span>已跳过</span>
  return <span>—</span>
}

interface QueueRowProps {
  item: QueueItem
  index: number
  running: boolean
  onRemove: (id: string) => void
}

const QueueRow = memo(function QueueRow({ item, index, running, onRemove }: QueueRowProps) {
  const ratio = item.compressedSize ? Math.max(5, Math.min(100, item.compressedSize / item.originalSize * 100)) : 100
  return (
    <article className="queue-row grid h-[92px] grid-cols-[38px_minmax(0,1fr)_112px_96px_34px] items-center gap-3 border-b border-[#E5E5EA] px-4" role="listitem">
      <div className="relative flex h-9 w-9 items-center justify-center overflow-hidden rounded-[7px] bg-[#ECECF0] text-[#6E6E73]">
        {item.thumbnailDataUrl ? <img src={item.thumbnailDataUrl} alt="" className="h-full w-full object-cover" /> : <FileImage className="h-4 w-4" />}
        <span className="absolute bottom-0 right-0 bg-black/55 px-1 font-mono text-[8px] leading-3 text-white">{index + 1}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium text-[#1D1D1F]" title={item.sourcePath}>{item.name}</p>
          {item.savingsPercent !== undefined ? <span className="rounded-full bg-[#E9F5EE] px-1.5 py-0.5 font-mono text-[10px] text-[#26845B]">−{item.savingsPercent.toFixed(1)}%</span> : null}
        </div>
        <p className={`mt-1 truncate text-[11px] ${item.error ? 'text-[#C13C45]' : 'text-[#86868B]'}`} title={item.error ?? item.parentLabel}>{item.error ?? item.parentLabel}</p>
      </div>
      <div className="min-w-0 text-right text-[11px] text-[#6E6E73]">
        <p className="font-mono text-[#343438]">{formatBytes(item.originalSize)}</p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#E5E5EA]"><span className="block h-full rounded-full bg-[#A1A1A6]" style={{ width: '100%' }} /></div>
      </div>
      <div className="min-w-0 text-right text-[11px] text-[#6E6E73]">
        <p className="truncate"><ResultValue item={item} /></p>
        <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-[#E5E5EA]"><span className={`block h-full rounded-full bg-[#0A63C9] ${item.status === 'completed' ? 'transition-[width] duration-200 motion-reduce:transition-none' : ''}`} style={{ width: `${item.status === 'completed' ? ratio : item.status === 'compressing' ? 42 : 0}%` }} /></div>
      </div>
      <div className="flex items-center justify-end gap-1">
        <span className="flex h-7 w-7 items-center justify-center" aria-label={item.status}><StatusIcon item={item} /></span>
        {!running && item.status === 'queued' ? <button type="button" className="queue-remove absolute flex h-7 w-7 items-center justify-center rounded-md text-[#86868B] hover:bg-[#F2F2F7] hover:text-[#C13C45] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0A63C9]" onClick={() => onRemove(item.id)} aria-label={`移除 ${item.name}`}><X className="h-3.5 w-3.5" /></button> : null}
      </div>
    </article>
  )
})

interface FileQueueProps {
  snapshot: QueueSnapshot
  running: boolean
  scanning: boolean
  outputMode: OutputMode
  onRemove: (id: string) => void
  onClear: () => void
  onOpenResults: (ids: string[]) => void
  onRequestThumbnails: (ids: string[]) => void
}

export function FileQueue({ snapshot, running, scanning, outputMode, onRemove, onClear, onOpenResults, onRequestThumbnails }: FileQueueProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<number | null>(null)
  const requestedSignatureRef = useRef('')
  const [viewport, setViewport] = useState({ scrollTop: 0, height: 420 })
  const itemCount = snapshot.order.length
  const metrics = useMemo(() => queueMetrics(snapshot), [snapshot])
  const completedIds = useMemo(() => snapshot.order.filter((id) => snapshot.items.get(id)?.status === 'completed'), [snapshot])
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN)
    const end = Math.min(itemCount, Math.ceil((viewport.scrollTop + viewport.height) / ROW_HEIGHT) + OVERSCAN)
    return { start, end }
  }, [itemCount, viewport])
  const visibleIds = useMemo(() => snapshot.order.slice(visibleRange.start, visibleRange.end), [snapshot.order, visibleRange])

  const measure = useCallback(() => {
    const element = scrollRef.current
    if (!element) return
    setViewport({ scrollTop: element.scrollTop, height: element.clientHeight || 420 })
  }, [])

  useLayoutEffect(() => {
    measure()
    const element = scrollRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [measure])

  useEffect(() => {
    const missing = visibleIds.filter((id) => !snapshot.items.get(id)?.thumbnailDataUrl)
    const signature = `${running}:${missing.join(',')}`
    if (missing.length === 0 || requestedSignatureRef.current === signature) return
    requestedSignatureRef.current = signature
    onRequestThumbnails(missing)
  }, [onRequestThumbnails, running, snapshot.revision, snapshot.items, visibleIds])

  const onScroll = useCallback(() => {
    if (frameRef.current !== null) return
    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null
      measure()
    })
  }, [measure])

  useEffect(() => () => {
    if (frameRef.current !== null) window.cancelAnimationFrame(frameRef.current)
  }, [])

  return (
    <section className="queue-panel flex min-h-0 flex-1 flex-col" aria-labelledby="queue-title">
      <header className="flex h-12 shrink-0 items-center justify-between border-b border-[#D2D2D7] px-4">
        <div className="flex items-center gap-2">
          <h2 id="queue-title" className="text-[13px] font-semibold text-[#1D1D1F]">压缩队列</h2>
          <span className="rounded-full bg-[#ECECF0] px-2 py-0.5 font-mono text-[10px] text-[#6E6E73]">全部 {itemCount.toLocaleString()} 张</span>
          {scanning ? <span className="flex items-center gap-1 text-[11px] text-[#0A63C9]"><Loader2 className="h-3 w-3 animate-spin" />正在导入</span> : null}
        </div>
        <div className="flex items-center gap-1.5">
          {outputMode === 'new_folder' && completedIds.length > 0 ? <Button variant="outline" size="sm" onClick={() => onOpenResults(completedIds)} title="在系统文件管理器中打开压缩结果"><FolderOutput className="h-3.5 w-3.5" />查看结果</Button> : null}
          <Button variant="ghost" size="sm" onClick={onClear} disabled={running || itemCount === 0}><Trash2 className="h-3.5 w-3.5" />清空</Button>
        </div>
      </header>
      {itemCount === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center text-center text-[#86868B]">
          <FileImage className="mb-3 h-7 w-7 stroke-[1.3]" />
          <p className="text-[13px]">尚未加入图片</p>
          <p className="mt-1 text-[11px]">导入后将立即显示文件列表。</p>
        </div>
      ) : (
        <>
          <div className="queue-overview" aria-label="全局压缩进度">
            <div className="min-w-0">
              <div className="flex items-baseline justify-between gap-3 text-[11px] text-[#6E6E73]">
                <p><span className="font-medium text-[#343438]">总进度</span><span className="ml-2 font-mono">{metrics.processed.toLocaleString()} / {metrics.total.toLocaleString()} 张</span></p>
                <span className="font-mono text-[#343438]">{metrics.progressPercent.toFixed(0)}%</span>
              </div>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-[#E5E5EA]" role="progressbar" aria-label="压缩总进度" aria-valuemin={0} aria-valuemax={metrics.total} aria-valuenow={metrics.processed}>
                <span className="block h-full rounded-full bg-[#0A63C9] transition-[width] duration-200 motion-reduce:transition-none" style={{ width: `${metrics.progressPercent}%` }} />
              </div>
              <p className="mt-2 text-[10px] text-[#86868B]">已完成 {metrics.completed.toLocaleString()} 张{metrics.compressing > 0 ? `，正在处理 ${metrics.compressing} 张` : ''}{metrics.failed > 0 ? `，失败 ${metrics.failed} 张` : ''}{metrics.skipped > 0 ? `，跳过 ${metrics.skipped} 张` : ''}{metrics.cancelled > 0 ? `，已取消 ${metrics.cancelled} 张` : ''}</p>
            </div>
            <div className="queue-savings">
              <p>总压缩率</p>
              {metrics.savingsPercent === null ? <strong>等待完成</strong> : <><strong>减少 {metrics.savingsPercent.toFixed(1)}%</strong><span>节省 {formatBytes(metrics.savedBytes)}</span></>}
            </div>
          </div>
          <div className="queue-columns grid shrink-0 grid-cols-[38px_minmax(0,1fr)_112px_96px_34px] gap-3 border-b border-[#E5E5EA] px-4 py-2 text-[10px] font-medium uppercase tracking-[0.06em] text-[#86868B]"><span /><span>文件</span><span className="text-right">原始</span><span className="text-right">压缩后</span><span /></div>
          <div ref={scrollRef} className="queue-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain" onScroll={onScroll} role="list" aria-label="图片压缩队列">
            <div className="relative" style={{ height: itemCount * ROW_HEIGHT }}>
              <div className="absolute inset-x-0" style={{ transform: `translateY(${visibleRange.start * ROW_HEIGHT}px)` }}>
                {visibleIds.map((id, offset) => {
                  const item = snapshot.items.get(id)
                  return item ? <QueueRow key={id} item={item} index={visibleRange.start + offset} running={running} onRemove={onRemove} /> : null
                })}
              </div>
            </div>
          </div>
        </>
      )}
    </section>
  )
}
