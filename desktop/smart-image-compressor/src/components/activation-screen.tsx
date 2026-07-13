import { useEffect, useState, type FormEvent } from 'react'
import { Aperture, CalendarClock, ImageIcon, KeyRound, Loader2, LockKeyhole, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { extractActivationCode } from '@/lib/activation'
import type { ActivationPlanPreview } from '@/types'

interface ActivationScreenProps {
  initialCode: string
  serviceMessage: string | null
  onPreview: (code: string) => Promise<ActivationPlanPreview>
  onRedeem: (code: string) => Promise<void>
}

export function ActivationScreen({ initialCode, serviceMessage, onPreview, onRedeem }: ActivationScreenProps) {
  const [value, setValue] = useState(initialCode)
  const [loading, setLoading] = useState(false)
  const [previewing, setPreviewing] = useState(false)
  const [previewResult, setPreviewResult] = useState<{ code: string; plan: ActivationPlanPreview } | null>(null)
  const [previewError, setPreviewError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (initialCode) setValue(initialCode)
  }, [initialCode])

  useEffect(() => {
    const code = extractActivationCode(value)
    setPreviewResult(null)
    setPreviewError(null)
    if (code.length < 20 || code.length > 256) {
      setPreviewing(false)
      return
    }

    let cancelled = false
    setPreviewing(true)
    const timer = window.setTimeout(() => {
      void onPreview(code)
        .then((plan) => {
          if (!cancelled) setPreviewResult({ code, plan })
        })
        .catch((error) => {
          if (!cancelled) setPreviewError(error instanceof Error ? error.message : String(error))
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 350)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [onPreview, value])

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const code = extractActivationCode(value)
    if (!code) {
      setError('请粘贴 Auth Link 或输入授权码。')
      return
    }

    setLoading(true)
    setError(null)
    try {
      await onRedeem(code)
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col overflow-hidden bg-[#F3F6FA] text-[#172033]">
      <header className="flex h-16 shrink-0 items-center border-b border-[#D6DDE8] bg-white px-6">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-[9px] bg-[#172033] text-white"><Aperture className="h-5 w-5" /></div>
          <div><h1 className="text-sm font-semibold">智能压缩工具</h1><p className="font-mono text-[9px] uppercase tracking-[0.16em] text-[#8792A5]">Imaging calibration desk</p></div>
        </div>
      </header>

      <div className="grid flex-1 place-items-center px-8 py-10">
        <section className="w-full max-w-[520px] rounded-[12px] border border-[#D6DDE8] bg-white p-8 shadow-[0_12px_32px_rgba(23,32,51,0.06)]" aria-labelledby="activation-title">
          <div className="flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#2956D8]/10 text-[#2956D8]">
            <LockKeyhole className="h-5 w-5" />
          </div>
          <p className="mt-6 font-mono text-[10px] uppercase tracking-[0.18em] text-[#667085]">Device activation</p>
          <h2 id="activation-title" className="mt-2 text-2xl font-semibold tracking-[-0.02em]">激活后进入压缩工作台</h2>
          <p className="mt-3 text-sm leading-6 text-[#667085]">粘贴管理员提供的 Auth Link。授权验证成功后，本设备将绑定套餐并进入图片压缩主页面。</p>

          <form className="mt-7" onSubmit={(event) => void submit(event)}>
            <label className="block text-xs font-medium text-[#42506A]" htmlFor="activation-link">Auth Link 或授权码</label>
            <div className="relative mt-2">
              <KeyRound className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-[#8B96A9]" />
              <textarea
                id="activation-link"
                value={value}
                onChange={(event) => {
                  setValue(event.target.value)
                  setError(null)
                }}
                placeholder="https://…/activate/…"
                rows={3}
                autoFocus
                spellCheck={false}
                className="w-full resize-none rounded-[8px] border border-[#C8D1DF] bg-white py-2.5 pl-9 pr-3 font-mono text-xs leading-5 text-[#172033] outline-none focus:border-[#2956D8] focus:ring-2 focus:ring-[#2956D8]/15"
              />
            </div>

            {error || previewError || serviceMessage ? (
              <p role="alert" className="mt-3 rounded-[8px] border border-[#C53D47]/20 bg-[#C53D47]/5 px-3 py-2 text-sm leading-5 text-[#A4313A]">{error ?? previewError ?? serviceMessage}</p>
            ) : null}

            <Button className="mt-5 w-full" type="submit" disabled={loading || previewing || previewResult?.code !== extractActivationCode(value)}>
              {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {loading ? '正在激活…' : '激活并进入工作台'}
            </Button>
          </form>

          <div className="mt-6 border-t border-[#E3E8F0] pt-5">
            {previewing ? (
              <div className="flex h-20 items-center justify-center gap-2 text-xs text-[#667085]"><Loader2 className="h-4 w-4 animate-spin text-[#2956D8]" />正在解析 Auth Link 授权方案…</div>
            ) : previewResult ? (
              <div className="grid grid-cols-3 gap-3">
                <div className="rounded-[8px] bg-[#F3F6FA] p-3"><KeyRound className="h-4 w-4 text-[#15806A]" /><p className="mt-2 font-mono text-base font-semibold text-[#172033]">{previewResult.plan.tokenCount}</p><p className="mt-0.5 text-[11px] text-[#667085]">TinyPNG Token</p></div>
                <div className="rounded-[8px] bg-[#F3F6FA] p-3"><ImageIcon className="h-4 w-4 text-[#15806A]" /><p className="mt-2 font-mono text-base font-semibold text-[#172033]">{previewResult.plan.compressionLimit.toLocaleString()}</p><p className="mt-0.5 text-[11px] text-[#667085]">可压缩张数</p></div>
                <div className="rounded-[8px] bg-[#F3F6FA] p-3"><CalendarClock className="h-4 w-4 text-[#15806A]" /><p className="mt-2 font-mono text-base font-semibold text-[#172033]">{previewResult.plan.durationDays} 天</p><p className="mt-0.5 text-[11px] text-[#667085]">激活后有效</p></div>
              </div>
            ) : (
              <p className="flex h-20 items-center justify-center text-xs text-[#667085]">粘贴 Auth Link 后，将安全解析 Token、压缩额度与有效时间。</p>
            )}
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[#667085]"><ShieldCheck className="h-3.5 w-3.5 text-[#15806A]" />授权参数由服务端校验，凭证加密保存在本机</p>
          </div>
        </section>
      </div>
    </main>
  )
}
