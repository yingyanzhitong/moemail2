"use client"

import { useState, useEffect, useCallback } from "react"
import { Button } from "@/components/ui/button"
import { ImageIcon, Loader2, Copy, Trash2, RefreshCw } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useCopy } from "@/hooks/use-copy"
import { useRolePermission } from "@/hooks/use-role-permission"
import { PERMISSIONS } from "@/lib/permissions"

interface TinyPngKey {
  id: string
  apiKey: string
  email: string
  createdAt: string
}

export function TinyPngKeysPanel() {
  const [keys, setKeys] = useState<TinyPngKey[]>([])
  const [loading, setLoading] = useState(true)
  const [deleting, setDeleting] = useState<string | null>(null)
  const { toast } = useToast()
  const { copyToClipboard } = useCopy()
  const { checkPermission } = useRolePermission()
  const canManageApiKey = checkPermission(PERMISSIONS.MANAGE_API_KEY)

  const fetchKeys = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/tinypng/keys")
      if (!res.ok) throw new Error("获取失败")
      const data = await res.json() as { tinypngKeys: TinyPngKey[] }
      setKeys(data.tinypngKeys)
    } catch (error) {
      console.error(error)
      toast({
        title: "获取失败",
        description: "无法获取 TinyPNG API Keys",
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    if (canManageApiKey) {
      fetchKeys()
    }
  }, [canManageApiKey, fetchKeys])

  const deleteKey = async (id: string) => {
    try {
      setDeleting(id)
      const res = await fetch("/api/tinypng/keys", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id })
      })

      if (!res.ok) throw new Error("删除失败")

      setKeys(prev => prev.filter(k => k.id !== id))
      toast({
        title: "删除成功",
        description: "TinyPNG API Key 已删除"
      })
    } catch (error) {
      console.error(error)
      toast({
        title: "删除失败",
        description: "无法删除该 Key",
        variant: "destructive"
      })
    } finally {
      setDeleting(null)
    }
  }

  const copyAllKeys = () => {
    const text = keys.map(k => k.apiKey).join("\n")
    copyToClipboard(text)
  }

  if (!canManageApiKey) {
    return null
  }

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6 space-y-6">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-2">
          <ImageIcon className="w-5 h-5 text-primary" />
          <h2 className="text-lg font-semibold">TinyPNG API Keys</h2>
        </div>
        <div className="flex gap-2">
          {keys.length > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={copyAllKeys}
              className="gap-2"
            >
              <Copy className="w-4 h-4" />
              复制全部
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={fetchKeys}
            disabled={loading}
            className="gap-2"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        </div>
      </div>

      <div className="space-y-4">
        {loading ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <Loader2 className="w-6 h-6 text-primary animate-spin" />
            </div>
            <p className="text-sm text-muted-foreground">加载中...</p>
          </div>
        ) : keys.length === 0 ? (
          <div className="text-center py-8 space-y-3">
            <div className="w-12 h-12 rounded-full bg-primary/10 flex items-center justify-center mx-auto">
              <ImageIcon className="w-6 h-6 text-primary" />
            </div>
            <div>
              <h3 className="text-lg font-medium">暂无 TinyPNG API Keys</h3>
              <p className="text-sm text-muted-foreground mt-1">
                点击导航栏的 TinyPNG 按钮批量生成
              </p>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-sm text-muted-foreground mb-2">
              共 {keys.length} 个 API Key
            </div>
            <div className="max-h-96 overflow-y-auto space-y-2">
              {keys.map((key) => (
                <div
                  key={key.id}
                  className="flex items-center justify-between p-4 rounded-lg border bg-card"
                >
                  <div className="space-y-1 min-w-0 flex-1">
                    <div className="font-mono text-sm truncate pr-4">
                      {key.apiKey}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {key.email} · {new Date(key.createdAt).toLocaleString()}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => copyToClipboard(key.apiKey)}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => deleteKey(key.id)}
                      disabled={deleting === key.id}
                    >
                      {deleting === key.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
