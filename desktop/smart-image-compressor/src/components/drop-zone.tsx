import { FolderOpen, ImagePlus, ScanLine } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface DropZoneProps {
  active: boolean
  disabled: boolean
  onPickImages: () => void
  onPickFolder: () => void
}

export function DropZone({ active, disabled, onPickImages, onPickFolder }: DropZoneProps) {
  return (
    <section className={`relative overflow-hidden rounded-xl border bg-white px-6 py-7 transition-colors ${active ? 'border-[#2956D8] bg-[#2956D8]/[0.025]' : 'border-[#D6DDE8]'}`}>
      <div className="pointer-events-none absolute inset-x-0 top-0 h-[3px] bg-[#2956D8]" aria-hidden="true" />
      <div className="flex items-center justify-between gap-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-[10px] border border-[#BFCBE0] bg-[#F5F8FC] text-[#2956D8]">
            {active ? <ScanLine className="h-6 w-6" /> : <ImagePlus className="h-6 w-6" />}
          </div>
          <div>
            <h2 className="text-base font-semibold text-[#172033]">{active ? '松开以加入接触印样' : '拖入图片或文件夹'}</h2>
            <p className="mt-1 text-sm text-[#667085]">支持 AVIF、WebP、JPEG、PNG；文件夹会递归扫描。</p>
          </div>
        </div>
        <div className="flex shrink-0 gap-2">
          <Button variant="outline" onClick={onPickImages} disabled={disabled}><ImagePlus className="h-4 w-4" />选择图片</Button>
          <Button variant="outline" onClick={onPickFolder} disabled={disabled}><FolderOpen className="h-4 w-4" />选择文件夹</Button>
        </div>
      </div>
    </section>
  )
}
