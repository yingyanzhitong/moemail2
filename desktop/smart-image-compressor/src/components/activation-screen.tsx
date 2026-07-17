import { useEffect, useState, type FormEvent, type ReactNode } from 'react'
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

function previewWithDeadline(code: string, onPreview: (code: string) => Promise<ActivationPlanPreview>) {
  return Promise.race([
    onPreview(code),
    new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error('授权方案预览超时；仍可直接点击激活。')), 6000)),
  ])
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
      void previewWithDeadline(code, onPreview)
        .then((plan) => {
          if (!cancelled) setPreviewResult({ code, plan })
        })
        .catch((reason: unknown) => {
          if (!cancelled) setPreviewError(reason instanceof Error ? reason.message : String(reason))
        })
        .finally(() => {
          if (!cancelled) setPreviewing(false)
        })
    }, 250)
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
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }

  const canRedeem = extractActivationCode(value).length >= 20
  return (
    <main className="activation-window text-[#1D1D1F]">
      <header className="activation-titlebar"><div className="flex items-center gap-2"><div className="flex h-7 w-7 items-center justify-center rounded-md bg-[#0A63C9] text-white"><Aperture className="h-4 w-4" /></div><span className="text-[13px] font-semibold">智能压缩工具</span></div></header>
      <div className="flex flex-1 items-center justify-center p-8">
        <section className="activation-sheet" aria-labelledby="activation-title">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-[#E9F2FF] text-[#0A63C9]"><LockKeyhole className="h-5 w-5" /></div>
          <p className="mt-5 text-[11px] font-medium tracking-[0.08em] text-[#86868B]">设备授权</p>
          <h1 id="activation-title" className="mt-1.5 text-[24px] font-semibold tracking-[-0.03em]">激活后进入压缩工作台</h1>
          <p className="mt-2.5 max-w-[470px] text-[13px] leading-6 text-[#6E6E73]">粘贴管理员提供的 Auth Link。验证成功后，套餐凭证和 TinyPNG Token 将加密保存到本机。</p>

          <form className="mt-6" onSubmit={(event) => void submit(event)}>
            <label className="text-[12px] font-medium text-[#343438]" htmlFor="activation-link">Auth Link 或授权码</label>
            <div className="activation-field mt-2">
              <KeyRound className="pointer-events-none mt-3 h-4 w-4 shrink-0 text-[#86868B]" />
              <textarea id="activation-link" value={value} onChange={(event) => { setValue(event.target.value); setError(null) }} placeholder="https://…/activate/…" rows={3} autoFocus spellCheck={false} className="min-w-0 flex-1 resize-none bg-transparent py-2.5 pr-2 font-mono text-[12px] leading-5 outline-none" />
            </div>
            {error || serviceMessage ? <p role="alert" className="activation-error">{error ?? serviceMessage}</p> : null}
            <Button className="mt-4 w-full" type="submit" disabled={loading || !canRedeem}>{loading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{loading ? '正在激活…' : '激活并进入工作台'}</Button>
          </form>

          <div className="mt-6 border-t border-[#E5E5EA] pt-4">
            {previewing ? <div className="flex h-[76px] items-center justify-center gap-2 text-[12px] text-[#6E6E73]"><Loader2 className="h-4 w-4 animate-spin text-[#0A63C9]" />正在读取授权方案…</div> : previewResult ? <div className="grid grid-cols-3 gap-2.5"><PlanMetric icon={<KeyRound className="h-4 w-4" />} value={previewResult.plan.tokenCount.toLocaleString()} label="TinyPNG Token" /><PlanMetric icon={<ImageIcon className="h-4 w-4" />} value={previewResult.plan.compressionLimit.toLocaleString()} label="可压缩张数" /><PlanMetric icon={<CalendarClock className="h-4 w-4" />} value={`${previewResult.plan.durationDays} 天`} label="激活后有效" /></div> : <p className="flex h-[76px] items-center justify-center text-[12px] text-[#6E6E73]">输入 Auth Link 后会显示 Token、额度和有效期。</p>}
            {previewError ? <p className="mt-2 text-[11px] text-[#B4232B]">{previewError}</p> : null}
            <p className="mt-4 flex items-center justify-center gap-1.5 text-[11px] text-[#6E6E73]"><ShieldCheck className="h-3.5 w-3.5 text-[#26845B]" />授权数据由服务端核验，凭证仅保存在本机</p>
          </div>
        </section>
      </div>
    </main>
  )
}

function PlanMetric({ icon, value, label }: { icon: ReactNode; value: string; label: string }) {
  return <div className="rounded-lg bg-[#F5F5F7] p-2.5 text-[#0A63C9]">{icon}<p className="mt-2 font-mono text-[16px] font-semibold text-[#1D1D1F]">{value}</p><p className="mt-1 text-[10px] text-[#6E6E73]">{label}</p></div>
}
