import { AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface OverwriteConfirmDialogProps {
  open: boolean
  imageCount: number
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}

export function OverwriteConfirmDialog({ open, imageCount, onOpenChange, onConfirm }: OverwriteConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="flex h-10 w-10 items-center justify-center rounded-[9px] bg-[#C53D47]/10 text-[#C53D47]">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <DialogTitle>确认覆盖 {imageCount.toLocaleString()} 张原图？</DialogTitle>
          <DialogDescription>
            压缩成功后将原子替换源图片，无法从本软件恢复。压缩失败的文件不会被修改。
          </DialogDescription>
        </DialogHeader>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>取消</Button>
          <Button variant="danger" onClick={onConfirm}>确认覆盖并开始</Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
