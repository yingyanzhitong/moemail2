import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { ExternalLink, QrCode } from 'lucide-react'
import { getPurchaseConfig, openPurchaseUrl } from '@/lib/desktop-api'
import type { PurchaseConfig } from '@/types'

export function PurchaseEntry() {
  const [config, setConfig] = useState<PurchaseConfig | null>(null)
  const [qrCode, setQrCode] = useState<string | null>(null)
  const [openError, setOpenError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    void getPurchaseConfig()
      .then((next) => {
        if (!cancelled) setConfig(next)
      })
      .catch(() => {
        if (!cancelled) setConfig(null)
      })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    if (!config) {
      setQrCode(null)
      return
    }
    let cancelled = false
    void QRCode.toDataURL(config.purchaseUrl, {
      errorCorrectionLevel: 'M',
      margin: 1,
      width: 320,
    })
      .then((dataUrl) => {
        if (!cancelled) setQrCode(dataUrl)
      })
      .catch(() => {
        if (!cancelled) setQrCode(null)
      })
    return () => {
      cancelled = true
    }
  }, [config])

  if (!config) return null

  const handleOpen = () => {
    setOpenError(null)
    void openPurchaseUrl(config.purchaseUrl).catch(() => setOpenError('无法打开闲鱼，请使用手机扫码。'))
  }

  return (
    <section className="purchase-entry" aria-label="添加套餐或续费">
      <div className="purchase-qr" aria-hidden={!qrCode}>
        {qrCode ? <img src={qrCode} alt="闲鱼购买二维码" /> : <QrCode className="h-7 w-7 text-[#86868B]" />}
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-semibold text-[#1D1D1F]">需要添加套餐或续费？</p>
        <p className="mt-1 text-[11px] leading-4 text-[#6E6E73]">电脑点击打开闲鱼；手机使用闲鱼或相机扫码购买。</p>
        <button type="button" className="purchase-link" onClick={handleOpen}>
          电脑打开闲鱼<ExternalLink className="h-3.5 w-3.5" />
        </button>
        {openError ? <p role="alert" className="mt-1 text-[10px] text-[#B4232B]">{openError}</p> : null}
      </div>
    </section>
  )
}
