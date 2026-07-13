import * as ProgressPrimitive from '@radix-ui/react-progress'
import { cn } from '@/lib/utils'

export function Progress({ value = 0, className, ...props }: ProgressPrimitive.ProgressProps) {
  return (
    <ProgressPrimitive.Root className={cn('relative h-2 w-full overflow-hidden rounded-full bg-[#E4E9F1]', className)} {...props}>
      <ProgressPrimitive.Indicator className="h-full bg-[#2956D8] transition-transform duration-300 motion-reduce:transition-none" style={{ transform: `translateX(-${100 - Math.min(100, Math.max(0, Number(value)))}%)` }} />
    </ProgressPrimitive.Root>
  )
}
