"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog"
import { Copy, Loader2 } from "lucide-react"
import { useCopy } from "@/hooks/use-copy"

interface TinyPngKeyViewerProps {
  emailAddress: string
  isOpen: boolean
  onClose: () => void
}

interface TinyPngKeyData {
  apiKey: string
  email: string
  createdAt: string
}

export function TinyPngKeyViewer({ emailAddress, isOpen, onClose }: TinyPngKeyViewerProps) {
  const [loading, setLoading] = useState(false)
  const [keyData, setKeyData] = useState<TinyPngKeyData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { copyToClipboard } = useCopy()

  useEffect(() => {
    const fetchApiKey = async () => {
      setLoading(true)
      setError(null)
      setKeyData(null)
  
      try {
        const response = await fetch(`/api/tinypng/keys?email=${encodeURIComponent(emailAddress)}`)
        
        if (!response.ok) {
          const data = await response.json()
          throw new Error((data as { error: string }).error || "获取 API Key 失败")
        }
  
        const data = await response.json() as { key: TinyPngKeyData }
        setKeyData(data.key)
      } catch (err) {
        const message = err instanceof Error ? err.message : "未知错误"
        setError(message)
      } finally {
        setLoading(false)
      }
    }

    if (isOpen && emailAddress) {
      fetchApiKey()
    }
  }, [isOpen, emailAddress])

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="https://tinypng.com/images/favicon.ico" alt="TinyPNG" className="w-5 h-5" />
            TinyPNG API Key
          </DialogTitle>
          <DialogDescription className="break-all">
            {emailAddress}
          </DialogDescription>
        </DialogHeader>

        <div className="py-4">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-4">
              <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              <span className="text-sm text-muted-foreground">加载中...</span>
            </div>
          ) : error ? (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          ) : keyData ? (
            <div className="space-y-3">
              <div className="p-3 bg-secondary/50 rounded-lg">
                <div className="flex items-center justify-between gap-2">
                  <code className="text-sm font-mono break-all flex-1">
                    {keyData.apiKey}
                  </code>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="shrink-0 h-8 w-8"
                    onClick={() => copyToClipboard(keyData.apiKey)}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="text-xs text-muted-foreground">
                创建时间: {new Date(keyData.createdAt).toLocaleString()}
              </div>
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground py-4">
              未找到对应的 API Key
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}

/**
 * TinyPNG 图标按钮，用于邮箱列表
 */
interface TinyPngBadgeProps {
  emailAddress: string
}

export function TinyPngBadge({ emailAddress }: TinyPngBadgeProps) {
  const [showDialog, setShowDialog] = useState(false)

  // 只有 tinypng- 开头的邮箱才显示
  if (!emailAddress.startsWith("tinypng-")) {
    return null
  }

  return (
    <>
      <Button
        variant="ghost"
        size="icon"
        className="h-6 w-6 shrink-0"
        onClick={(e) => {
          e.stopPropagation()
          setShowDialog(true)
        }}
        title="查看 TinyPNG API Key"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="https://tinypng.com/images/favicon.ico" alt="TinyPNG" className="w-4 h-4" />
      </Button>
      
      <TinyPngKeyViewer
        emailAddress={emailAddress}
        isOpen={showDialog}
        onClose={() => setShowDialog(false)}
      />
    </>
  )
}
