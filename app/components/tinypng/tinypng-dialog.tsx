"use client"

import { useState, useMemo } from "react"
import { useSession } from "next-auth/react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogDescription } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, Copy } from "lucide-react"
import { useCopy } from "@/hooks/use-copy"
import { useRolePermission } from "@/hooks/use-role-permission"

interface GeneratedApiKey {
  email: string
  apiKey: string
}

// 每次请求的限制配置（需要与后端保持一致）
const PER_REQUEST_LIMITS = {
  emperor: 0,  // 0 表示无限制，但 UI 上限制为 50
  duke: 10,
  knight: 5,
  civilian: 0,
} as const

export function TinyPngDialog() {
  const { data: session } = useSession()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(1)
  const [loading, setLoading] = useState(false)
  const [progress, setProgress] = useState(0)
  const [results, setResults] = useState<GeneratedApiKey[]>([])
  const [error, setError] = useState<string | null>(null)
  const { toast } = useToast()
  const { copyToClipboard } = useCopy()
  const { roles } = useRolePermission()

  // 获取用户最高角色
  const highestRole = useMemo(() => {
    if (!roles?.length) return null
    // 角色优先级：emperor > duke > knight > civilian
    const priority = ['emperor', 'duke', 'knight', 'civilian']
    for (const role of priority) {
      if (roles.some(r => r.name === role)) return role
    }
    return null
  }, [roles])

  // 根据用户角色计算最大生成数量
  const maxCount = useMemo(() => {
    if (!highestRole) return 0
    const limit = PER_REQUEST_LIMITS[highestRole as keyof typeof PER_REQUEST_LIMITS]
    if (limit === 0) return 50  // 皇帝无限制，UI 上限为 50
    return limit
  }, [highestRole])

  const handleCountChange = (value: string) => {
    const num = parseInt(value) || 1
    setCount(Math.min(maxCount, Math.max(1, num)))
  }

  const generateApiKeys = async () => {
    setLoading(true)
    setProgress(0)
    setResults([])
    setError(null)

    try {
      // 1. 首先获取或创建 "tinypng" 专用 API Key
      const apiKeyResponse = await fetch("/api/api-keys/tinypng")
      if (!apiKeyResponse.ok) {
        const data = await apiKeyResponse.json()
        throw new Error((data as { error: string }).error || "获取 API Key 失败")
      }
      const { apiKey: moEmailApiKey } = await apiKeyResponse.json() as { apiKey: string }

      // 2. 使用批量生成 API
      setProgress(1) // 表示正在处理
      const response = await fetch("/api/tinypng/generate/batch", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "X-API-Key": moEmailApiKey,
        },
        body: JSON.stringify({ count }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error((data as { error: string }).error || "批量生成失败")
      }

      const data = await response.json() as {
        success: boolean
        results: { email: string; apiKey?: string; error?: string }[]
        totalSuccess: number
        totalFailed: number
      }

      // 转换结果
      const generated: GeneratedApiKey[] = data.results
        .filter(r => r.apiKey)
        .map(r => ({
          email: r.email,
          apiKey: r.apiKey!,
        }))

      setResults(generated)
      setProgress(count)

      if (data.totalFailed > 0) {
        const failedMessages = data.results
          .filter(r => r.error)
          .map(r => `${r.email}: ${r.error}`)
          .join('\n')
        setError(`${data.totalFailed} 个生成失败:\n${failedMessages}`)
      }

      if (generated.length > 0) {
        toast({
          title: "生成完成",
          description: `成功生成 ${generated.length} 个 TinyPNG API Key`,
        })
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "未知错误"
      setError(message)
    } finally {
      setLoading(false)
    }
  }

  const copyAllKeys = () => {
    const keysText = results.map(r => r.apiKey).join("\n")
    copyToClipboard(keysText)
  }

  const copyAllResults = () => {
    const text = results.map(r => `${r.email}\t${r.apiKey}`).join("\n")
    copyToClipboard(text)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (!isOpen) {
      // Reset state when closing
      setResults([])
      setError(null)
      setProgress(0)
    }
  }

  // 未登录时不显示
  if (!session) {
    return null
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="gap-2 hidden sm:flex">
          <img src="https://tinypng.com/images/favicon.ico" alt="TinyPNG" className="w-4 h-4" />
          <span className="hidden md:inline">TinyPNG</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <img src="https://tinypng.com/images/favicon.ico" alt="TinyPNG" className="w-5 h-5" />
            批量生成 TinyPNG API Key
          </DialogTitle>
          <DialogDescription>
            自动生成临时邮箱注册 TinyPNG 并获取 API Key
          </DialogDescription>
        </DialogHeader>
        
        <div className="space-y-4 py-4">
          {/* Input section */}
          {results.length === 0 && (
            <div className="flex items-center gap-4">
              <Label htmlFor="count" className="shrink-0">
                生成数量:
              </Label>
              <Input
                id="count"
                type="number"
                min={1}
                max={maxCount}
                value={count}
                onChange={(e) => handleCountChange(e.target.value)}
                className="w-24"
                disabled={loading || maxCount === 0}
              />
              <span className="text-sm text-muted-foreground">
                (1-{maxCount} 个/次)
              </span>
            </div>
          )}

          {/* Progress section */}
          {loading && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>正在生成第 {progress} / {count} 个...</span>
              </div>
              <div className="w-full bg-secondary rounded-full h-2">
                <div
                  className="bg-primary rounded-full h-2 transition-all"
                  style={{ width: `${(progress / count) * 100}%` }}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                每个 API Key 需要约 10-30 秒生成，请耐心等待...
              </p>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive">
              {error}
            </div>
          )}

          {/* Results section */}
          {results.length > 0 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium">
                  生成结果 ({results.length} 个)
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyAllKeys}
                    className="gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    复制所有 Key
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={copyAllResults}
                    className="gap-1"
                  >
                    <Copy className="w-3 h-3" />
                    复制全部
                  </Button>
                </div>
              </div>
              <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-2">
                {results.map((result, index) => (
                  <div
                    key={index}
                    className="flex items-center gap-2 p-2 bg-secondary/50 rounded text-sm"
                  >
                    <span className="text-muted-foreground w-6">{index + 1}.</span>
                    <div className="flex-1 min-w-0 space-y-0.5">
                      <div className="text-xs text-muted-foreground truncate">
                        {result.email}
                      </div>
                      <div className="font-mono text-xs truncate">
                        {result.apiKey}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="shrink-0 h-8 w-8"
                      onClick={() => copyToClipboard(result.apiKey)}
                    >
                      <Copy className="w-3 h-3" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2">
          {results.length === 0 ? (
            <>
              <Button
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={loading}
              >
                取消
              </Button>
              <Button onClick={generateApiKeys} disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    生成中...
                  </>
                ) : (
                  "开始生成"
                )}
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                onClick={() => {
                  setResults([])
                  setError(null)
                }}
              >
                重新生成
              </Button>
              <Button onClick={() => setOpen(false)}>
                完成
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
