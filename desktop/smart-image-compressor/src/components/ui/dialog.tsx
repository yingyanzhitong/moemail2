import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

export function DialogContent({ className, children, ...props }: DialogPrimitive.DialogContentProps) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-[#172033]/30 backdrop-blur-[1px]" />
      <DialogPrimitive.Content className={cn('fixed left-1/2 top-1/2 z-50 w-[calc(100%-32px)] max-w-md -translate-x-1/2 -translate-y-1/2 rounded-xl border border-[#D6DDE8] bg-white p-6 shadow-[0_20px_60px_rgba(23,32,51,0.18)] focus:outline-none', className)} {...props}>
        {children}
        <DialogPrimitive.Close className="absolute right-4 top-4 rounded-md p-1 text-[#667085] hover:bg-[#EEF2F7] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2956D8]" aria-label="关闭">
          <X className="h-4 w-4" />
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('space-y-2 pr-8', className)} {...props} />
}
export function DialogTitle({ className, ...props }: DialogPrimitive.DialogTitleProps) {
  return <DialogPrimitive.Title className={cn('text-lg font-semibold tracking-tight text-[#172033]', className)} {...props} />
}
export function DialogDescription({ className, ...props }: DialogPrimitive.DialogDescriptionProps) {
  return <DialogPrimitive.Description className={cn('text-sm leading-6 text-[#667085]', className)} {...props} />
}
