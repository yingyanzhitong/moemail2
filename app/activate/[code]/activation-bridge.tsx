'use client'

import { useEffect, useMemo, useState } from 'react'
import { Check, Copy, ExternalLink, ShieldCheck } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

export function ActivationBridge({ code }: { code: string }) {
  const [copied, setCopied] = useState(false)
  const deepLink = useMemo(() => `smartcompress://activate?code=${encodeURIComponent(code)}`, [code])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      window.location.href = deepLink
    }, 250)
    return () => window.clearTimeout(timer)
  }, [deepLink])

  const copyCode = async () => {
    await navigator.clipboard.writeText(code)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-[#F3F6FA] px-5 py-10 text-[#172033]">
      <section className="w-full max-w-lg rounded-xl border border-[#D6DDE8] bg-white p-8 shadow-[0_12px_36px_rgba(23,32,51,0.08)]">
        <div className="mb-7 flex h-11 w-11 items-center justify-center rounded-[10px] bg-[#2956D8]/10 text-[#2956D8]">
          <ShieldCheck className="h-6 w-6" />
        </div>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#2956D8]">智能压缩工具</p>
        <h1 className="mt-2 text-2xl font-semibold tracking-tight">正在打开桌面应用</h1>
        <p className="mt-3 text-sm leading-6 text-[#5C667A]">
          如果应用没有自动打开，请点击下方按钮。你也可以复制授权码，在应用的授权窗口中手动粘贴。
        </p>

        <Button className="mt-7 w-full bg-[#2956D8] hover:bg-[#2148B7]" asChild>
          <a href={deepLink}>
            <ExternalLink className="mr-2 h-4 w-4" />
            打开智能压缩工具
          </a>
        </Button>

        <div className="mt-6 border-t border-[#D6DDE8] pt-6">
          <label htmlFor="activation-code" className="text-xs font-medium text-[#5C667A]">授权码</label>
          <div className="mt-2 flex gap-2">
            <Input id="activation-code" readOnly value={code} className="font-mono text-xs" />
            <Button type="button" variant="outline" size="icon" onClick={copyCode} aria-label="复制授权码">
              {copied ? <Check className="h-4 w-4 text-[#15806A]" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
          <p className="mt-3 text-xs text-[#778196]">授权链接仅可使用一次，并会在生成 24 小时后失效。</p>
        </div>
      </section>
    </main>
  )
}
