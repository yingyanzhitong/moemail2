import { memo } from 'react'
import { AlertCircle, Check, FileImage, Loader2, MinusCircle, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { CompressionStage, QueueItem } from '@/types'

const stageLabels: Record<CompressionStage, string> = {
  preparing: '正在准备',
  reading: '正在读取',
  uploading: '上传并等待 TinyPNG',
  downloading: '正在下载',
  writing: '正在写入',
}

function formatBytes(bytes: number) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`
}

function StatusIcon({ item }: { item: QueueItem }) {
  if (item.status === 'compressing') return <Loader2 className="h-4 w-4 animate-spin text-[#2956D8]" />
  if (item.status === 'completed') return <Check className="h-4 w-4 text-[#15806A]" />
  if (item.status === 'failed') return <AlertCircle className="h-4 w-4 text-[#C53D47]" />
  if (item.status === 'skipped' || item.status === 'cancelled') return <MinusCircle className="h-4 w-4 text-[#778196]" />
  return <span className="h-2 w-2 rounded-full border border-[#9DA9BC]" />
}

function CalibrationBars({ item }: { item: QueueItem }) {
  const compressedRatio = item.compressedSize ? Math.max(5, Math.min(100, item.compressedSize / item.originalSize * 100)) : 100
  const progressLabel = item.status === 'compressing'
    ? item.stage ? stageLabels[item.stage] : '正在准备'
    : '等待压缩'
  return (
    <div className="mt-3 grid grid-cols-[88px_1fr] items-center gap-x-3 gap-y-1.5 text-[10px] text-[#778196]">
      <span className="font-mono">原始 {formatBytes(item.originalSize)}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[#E4E9F1]"><span className="block h-full w-full rounded-full bg-[#AEB9CA]" /></span>
      <span className="font-mono">{item.compressedSize ? `压缩 ${formatBytes(item.compressedSize)}` : progressLabel}</span>
      <span className="h-1.5 overflow-hidden rounded-full bg-[#E4E9F1]">
        <span
          className={`block h-full rounded-full bg-[#2956D8] ${item.status === 'completed' ? 'transition-[width] duration-[220ms] ease-out motion-reduce:transition-none' : ''}`}
          style={{ width: `${item.status === 'completed' ? compressedRatio : 0}%` }}
        />
      </span>
    </div>
  )
}

interface FileQueueProps {
  items: QueueItem[]
  running: boolean
  onRemove: (id: string) => void
  onClear: () => void
}

interface QueueRowProps {
  item: QueueItem
  index: number
  running: boolean
  onRemove: (id: string) => void
}

const QueueRow = memo(function QueueRow({ item, index, running, onRemove }: QueueRowProps) {
  return (
    <article className="group grid grid-cols-[44px_minmax(0,1fr)_auto] gap-3 rounded-[10px] border border-transparent px-2.5 py-3 hover:border-[#D6DDE8] hover:bg-[#FAFBFD]">
      <div className="relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-[7px] border border-[#D6DDE8] bg-[#EEF2F7]">
        {item.thumbnailDataUrl ? <img src={item.thumbnailDataUrl} alt="" className="h-full w-full object-cover" /> : <FileImage className="h-5 w-5 text-[#7E8BA1]" />}
        <span className="absolute left-0 top-0 bg-[#172033]/75 px-1 font-mono text-[8px] text-white">{String(index + 1).padStart(2, '0')}</span>
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium" title={item.sourcePath}>{item.name}</p>
          {item.savingsPercent !== undefined ? <span className="shrink-0 rounded-full bg-[#15806A]/10 px-1.5 py-0.5 font-mono text-[10px] text-[#15806A]">−{item.savingsPercent.toFixed(1)}%</span> : null}
        </div>
        <p className="mt-0.5 truncate font-mono text-[10px] text-[#8792A5]" title={item.outputPath}>{item.parentLabel}</p>
        <CalibrationBars item={item} />
        {item.error ? <p className={`mt-2 text-xs ${item.status === 'failed' ? 'text-[#C53D47]' : 'text-[#667085]'}`}>{item.error}</p> : null}
      </div>
      <div className="flex items-start gap-1 pt-1">
        <span className="flex h-7 w-7 items-center justify-center" aria-label={item.status}><StatusIcon item={item} /></span>
        {!running && item.status === 'queued' ? (
          <Button variant="ghost" size="icon" className="h-7 w-7 opacity-0 group-hover:opacity-100 focus:opacity-100" onClick={() => onRemove(item.id)} aria-label={`移除 ${item.name}`}><X className="h-3.5 w-3.5" /></Button>
        ) : null}
      </div>
    </article>
  )
})

export function FileQueue({ items, running, onRemove, onClear }: FileQueueProps) {
  return (
    <section className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[#D6DDE8] bg-white">
      <header className="flex h-12 items-center justify-between border-b border-[#D6DDE8] px-4">
        <div className="flex items-baseline gap-2">
          <h2 className="text-sm font-semibold">接触印样</h2>
          <span className="font-mono text-[11px] text-[#778196]">{items.length.toString().padStart(2, '0')} IMAGES</span>
        </div>
        <Button variant="ghost" size="sm" onClick={onClear} disabled={running || items.length === 0}>清空</Button>
      </header>
      {items.length === 0 ? (
        <div className="flex h-[290px] flex-col items-center justify-center text-center text-[#778196]">
          <FileImage className="mb-3 h-8 w-8 stroke-[1.4]" />
          <p className="text-sm">尚未加入图片</p>
          <p className="mt-1 text-xs">任务完成后仍会保留结果，便于核对。</p>
        </div>
      ) : (
        <div className="queue-scroll max-h-[calc(100vh-265px)] min-h-[290px] overflow-y-auto p-2">
          {items.map((item, index) => (
            <QueueRow key={item.id} item={item} index={index} running={running} onRemove={onRemove} />
          ))}
        </div>
      )}
    </section>
  )
}
