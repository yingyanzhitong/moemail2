import { FolderOpen, ImagePlus, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DropZoneProps {
  active: boolean
  disabled: boolean
  scanning: boolean
  onPickImages: () => void
  onPickFolder: () => void
}

export function DropZone({ active, disabled, scanning, onPickImages, onPickFolder }: DropZoneProps) {
  return (
    <section className={`import-strip ${active ? 'import-strip-active' : ''}`} aria-label="导入图片">
      <div className="flex min-w-0 items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[#E9F2FF] text-[#0A63C9]">
          {active ? <ScanLine className="h-4.5 w-4.5" /> : <ImagePlus className="h-[18px] w-[18px]" />}
        </div>
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold text-[#1D1D1F]">{active ? '松开以加入队列' : scanning ? '正在扫描文件夹' : '拖入图片或文件夹'}</h2>
          <p className="mt-0.5 truncate text-[11px] text-[#86868B]">支持 AVIF、WebP、JPEG、PNG；文件会先显示，预览图随后载入。</p>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button variant="outline" size="sm" onClick={onPickImages} disabled={disabled}><ImagePlus className="h-3.5 w-3.5" />导入图片</Button>
        <Button variant="outline" size="sm" onClick={onPickFolder} disabled={disabled}><FolderOpen className="h-3.5 w-3.5" />导入文件夹</Button>
      </div>
    </section>
  )
}
