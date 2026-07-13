import { useEffect, useState } from 'react'
import { KeyRound, Loader2, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'

interface ActivationDialogProps {
  open: boolean
  initialCode: string
  onOpenChange: (open: boolean) => void
  onRedeem: (code: string) => Promise<void>
}

function extractCode(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    if (url.protocol === 'smartcompress:') return url.searchParams.get('code') ?? trimmed
    const segments = url.pathname.split('/').filter(Boolean)
    if (segments.at(-2) === 'activate') return segments.at(-1) ?? trimmed
  } catch {
    // 手动粘贴的纯授权码无需按 URL 解析。
  }
  return trimmed
}

export function ActivationDialog({ open, initialCode, onOpenChange, onRedeem }: ActivationDialogProps) {
  const [value, setValue] = useState(initialCode)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialCode) setValue(initialCode)
  }, [initialCode])

  const submit = async () => {
    const code = extractCode(value)
    if (!code) {
      setError('请粘贴授权链接或授权码。')
      return
    }
    setLoading(true)
    setError(null)
    try {
      await onRedeem(code)
      onOpenChange(false)
      setValue('')
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-[10px] bg-[#2956D8]/10 text-[#2956D8]">
            <ShieldCheck className="h-5 w-5" />
          </div>
          <DialogTitle>激活或续费授权</DialogTitle>
          <DialogDescription>粘贴管理员提供的 HTTPS 授权链接或一次性授权码。凭证会直接交给 Rust 层并加密保存。</DialogDescription>
        </DialogHeader>
        <label className="mt-5 block text-xs font-medium text-[#42506A]" htmlFor="activation-code">授权链接或授权码</label>
        <div className="relative mt-2">
          <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8B96A9]" />
          <textarea
            id="activation-code"
            value={value}
            onChange={(event) => setValue(event.target.value)}
            placeholder="https://…/activate/…"
            rows={3}
            spellCheck={false}
            className="w-full resize-none rounded-[8px] border border-[#C8D1DF] bg-white py-2.5 pl-9 pr-3 font-mono text-xs leading-5 text-[#172033] outline-none focus:border-[#2956D8] focus:ring-2 focus:ring-[#2956D8]/15"
          />
        </div>
        {error ? <p role="alert" className="mt-3 rounded-[8px] border border-[#C53D47]/20 bg-[#C53D47]/5 px-3 py-2 text-sm text-[#A4313A]">{error}</p> : null}
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={loading}>稍后处理</Button>
          <Button onClick={() => void submit()} disabled={loading || !value.trim()}>
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {loading ? '正在校验…' : '校验并激活'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
