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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { useTranslations } from "next-intl"

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
  
  // Manual mode state
  const [activeTab, setActiveTab] = useState("auto")
  const [manualStep, setManualStep] = useState<"idle" | "script" | "processing" | "completed">("idle")
  const [manualData, setManualData] = useState<{
    email: string
    emailId: string
    scripts: { curl: string; python: string; nodejs: string }
    apiKey?: string
  } | null>(null)



  const { toast } = useToast()
  const { copyToClipboard } = useCopy()
  const { roles } = useRolePermission()
  const t = useTranslations("common.tinypng")

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

  // Manual Mode Handlers
  const startManualProcess = async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tinypng/generate-front", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "init" }),
      })
      if (!res.ok) throw new Error("Failed to init manual process")
      const data = await res.json() as {
        email: string
        emailId: string
        scripts: { curl: string; python: string; nodejs: string }
      }
      setManualData(data)
      setManualStep("script")
    } catch (err) {
      setError(err instanceof Error ? err.message : "Init failed")
    } finally {
      setLoading(false)
    }
  }

  const finishManualProcess = async () => {
    if (!manualData?.emailId) return
    setLoading(true)
    setManualStep("processing")
    setError(null)
    try {
      const res = await fetch("/api/tinypng/generate-front", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "finish", emailId: manualData.emailId }),
      })
      const data = await res.json() as { error?: string; apiKey?: string }
      if (!res.ok) throw new Error(data.error || "Finish failed")
      
      setManualData(prev => prev ? { ...prev, apiKey: data.apiKey } : null)
      setManualStep("completed")
      toast({ title: "Success", description: "API Key generated successfully!" })
    } catch (err) {
      setError(err instanceof Error ? err.message : "Finish failed")
      setManualStep("script") // Go back to script step on error to retry
    } finally {
      setLoading(false)
    }
  }

  const resetManual = () => {
    setManualStep("idle")
    setManualData(null)
    setError(null)
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
      resetManual()
      setActiveTab("auto")
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
            {t("title")}
          </DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="auto">{t("tabs.auto")}</TabsTrigger>
            <TabsTrigger value="manual">{t("tabs.manual")}</TabsTrigger>
          </TabsList>

          <TabsContent value="auto" className="space-y-4 py-4">
             <div className="space-y-4">
               {/* Input section */}
              {results.length === 0 && (
                <div className="flex items-center gap-4">
                  <Label htmlFor="count" className="shrink-0">
                    {t("quantity")}:
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
                    {t("per_batch", { max: maxCount })}
                  </span>
                </div>
              )}

              {/* Progress section */}
              {loading && activeTab === 'auto' && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="w-4 h-4 animate-spin" />
                    <span>{t("processing", { progress, count })}</span>
                  </div>
                  <div className="w-full bg-secondary rounded-full h-2">
                    <div
                      className="bg-primary rounded-full h-2 transition-all"
                      style={{ width: `${(progress / count) * 100}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {t("wait_time")}
                  </p>
                </div>
              )}

              {/* Error display */}
              {error && activeTab === 'auto' && (
                <div className="p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm text-destructive whitespace-pre-wrap">
                  {error}
                </div>
              )}

              {/* Results section */}
              {results.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">
                      {t("results_title", { count: results.length })}
                    </span>
                    <div className="flex gap-2">
                      <Button variant="outline" size="sm" onClick={copyAllKeys} className="gap-1">
                        <Copy className="w-3 h-3" /> {t("actions.copy_keys")}
                      </Button>
                      <Button variant="outline" size="sm" onClick={copyAllResults} className="gap-1">
                        <Copy className="w-3 h-3" /> {t("actions.copy_all")}
                      </Button>
                    </div>
                  </div>
                  <div className="max-h-64 overflow-y-auto space-y-2 border rounded-lg p-2">
                    {results.map((result, index) => (
                      <div key={index} className="flex items-center gap-2 p-2 bg-secondary/50 rounded text-sm">
                        <span className="text-muted-foreground w-6">{index + 1}.</span>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="text-xs text-muted-foreground truncate">{result.email}</div>
                          <div className="font-mono text-xs truncate">{result.apiKey}</div>
                        </div>
                        <Button variant="ghost" size="icon" className="shrink-0 h-8 w-8" onClick={() => copyToClipboard(result.apiKey)}>
                          <Copy className="w-3 h-3" />
                        </Button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              
              {/* Auto Actions */}
               <div className="flex justify-end gap-2 pt-2">
                {results.length === 0 ? (
                    <>
                    <Button variant="outline" onClick={() => setOpen(false)} disabled={loading}>
                        {t("actions.cancel")}
                    </Button>
                    <Button onClick={generateApiKeys} disabled={loading}>
                        {loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" /> {t("actions.generating")}</> : t("actions.start")}
                    </Button>
                    </>
                ) : (
                    <>
                    <Button variant="outline" onClick={() => { setResults([]); setError(null); }}>
                        {t("actions.restart")}
                    </Button>
                    <Button onClick={() => setOpen(false)}>{t("actions.done")}</Button>
                    </>
                )}
                </div>
             </div>
          </TabsContent>

          <TabsContent value="manual" className="space-y-4 py-4">
             {manualStep === "idle" && (
                <div className="space-y-4">
                    <p className="text-sm text-muted-foreground">
                        {t("manual.description")}
                    </p>
                    <div className="flex justify-end">
                        <Button onClick={startManualProcess} disabled={loading}>
                            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : t("manual.start_btn")}
                        </Button>
                    </div>
                </div>
             )}

             {manualStep === "script" && manualData && (
                <div className="space-y-4">
                    <div className="p-4 bg-secondary/30 rounded-lg space-y-2">
                        <Label>{t("manual.step1_label")}</Label>
                        <div className="flex items-center gap-2">
                            <Input value={manualData.email} readOnly />
                            <Button size="icon" variant="ghost" onClick={() => copyToClipboard(manualData.email)}>
                                <Copy className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label>{t("manual.step2_label")}</Label>
                        <Tabs defaultValue="curl" className="w-full">
                            <TabsList className="w-full justify-start">
                                <TabsTrigger value="curl">cURL</TabsTrigger>
                                <TabsTrigger value="python">Python</TabsTrigger>
                                <TabsTrigger value="node">Node.js</TabsTrigger>
                            </TabsList>
                            <div className="mt-2 relative">
                                <TabsContent value="curl">
                                    <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                                        {manualData.scripts.curl}
                                    </pre>
                                    <Button size="sm" variant="secondary" className="absolute top-14 right-2" onClick={() => copyToClipboard(manualData.scripts.curl)}>Copy</Button>
                                </TabsContent>
                                <TabsContent value="python">
                                    <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                                        {manualData.scripts.python}
                                    </pre>
                                    <Button size="sm" variant="secondary" className="absolute top-14 right-2" onClick={() => copyToClipboard(manualData.scripts.python)}>Copy</Button>
                                </TabsContent>
                                <TabsContent value="node">
                                    <pre className="p-4 bg-muted rounded-lg text-xs overflow-x-auto whitespace-pre-wrap font-mono">
                                        {manualData.scripts.nodejs}
                                    </pre>
                                    <Button size="sm" variant="secondary" className="absolute top-14 right-2" onClick={() => copyToClipboard(manualData.scripts.nodejs)}>Copy</Button>
                                </TabsContent>
                            </div>
                        </Tabs>
                    </div>

                    <div className="flex justify-between items-center pt-2">
                         <span className="text-sm text-yellow-600 dark:text-yellow-400">
                             {t("manual.wait_hint")}
                         </span>
                         <Button onClick={finishManualProcess}>
                             {t("manual.registered_btn")}
                         </Button>
                    </div>
                    {error && <p className="text-sm text-destructive">{error}</p>}
                </div>
             )}

             {manualStep === "processing" && (
                <div className="flex flex-col items-center justify-center py-8 space-y-4">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <p className="text-sm text-muted-foreground">{t("manual.processing_title")}</p>
                    <p className="text-xs text-muted-foreground">{t("manual.processing_desc")}</p>
                </div>
             )}

             {manualStep === "completed" && manualData?.apiKey && (
                 <div className="space-y-4">
                    <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg flex flex-col items-center gap-2">
                        <div className="h-12 w-12 bg-green-100 dark:bg-green-900 rounded-full flex items-center justify-center">
                            <span className="text-2xl">🎉</span>
                        </div>
                        <h3 className="font-semibold text-green-700 dark:text-green-300">{t("manual.success_title")}</h3>
                    </div>

                    <div className="space-y-2">
                        <Label>API Key</Label>
                        <div className="flex items-center gap-2">
                            <code className="flex-1 p-2 bg-muted rounded font-mono text-sm break-all">
                                {manualData.apiKey}
                            </code>
                            <Button size="icon" variant="ghost" onClick={() => copyToClipboard(manualData.apiKey!)}>
                                <Copy className="w-4 h-4" />
                            </Button>
                        </div>
                    </div>

                    <div className="flex justify-end pt-2">
                        <Button onClick={resetManual}>{t("manual.generate_another")}</Button>
                    </div>
                 </div>
             )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
