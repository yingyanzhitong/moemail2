import { ChevronDown, FolderOpen, ImagePlus, Pause, Play, ScanLine } from 'lucide-react'
import { useState } from 'react'
import { Button } from '@/components/ui/button'

interface DropZoneProps {
  active: boolean
  disabled: boolean
  scanning: boolean
  canStart: boolean
  running: boolean
  onPickImages: () => void
  onPickFolder: () => void
  onStart: () => void
  onCancel: () => void
}

export function DropZone({ active, disabled, scanning, canStart, running, onPickImages, onPickFolder, onStart, onCancel }: DropZoneProps) {
  const [importMenuOpen, setImportMenuOpen] = useState(false)
  const pickImages = () => {
    setImportMenuOpen(false)
    onPickImages()
  }
  const pickFolder = () => {
    setImportMenuOpen(false)
    onPickFolder()
  }
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
        <div className="import-menu">
          <Button variant="outline" size="sm" onClick={() => setImportMenuOpen((open) => !open)} disabled={disabled} aria-haspopup="menu" aria-expanded={importMenuOpen}><ImagePlus className="h-3.5 w-3.5" />导入图片<ChevronDown className="h-3.5 w-3.5" /></Button>
          {importMenuOpen ? <div className="import-menu-popover" role="menu" aria-label="导入方式">
            <button type="button" role="menuitem" onClick={pickImages}><ImagePlus className="h-3.5 w-3.5" />选择图片</button>
            <button type="button" role="menuitem" onClick={pickFolder}><FolderOpen className="h-3.5 w-3.5" />选择文件夹</button>
          </div> : null}
        </div>
        {running ? <Button variant="danger" size="sm" onClick={onCancel}><Pause className="h-3.5 w-3.5" />取消</Button> : <Button size="sm" onClick={onStart} disabled={!canStart} title={scanning ? '正在扫描导入内容' : canStart ? undefined : '请先导入图片并保持授权有效'}><Play className="h-3.5 w-3.5 fill-current" />开始压缩</Button>}
      </div>
    </section>
  )
}
