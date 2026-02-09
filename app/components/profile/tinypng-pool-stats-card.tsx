"use client"

import { useEffect, useState } from "react"
import { Database, Link, Copy, Check, Loader2 } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale } from "next-intl"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

interface PoolStats {
  total: number
  active: number
  pending: number
  used: number
}

interface GenerateResponse {
  success: boolean
  authLink?: string
  keyCount?: number
  expiresAt?: string
  code?: string
  error?: string
}

export function TinyPngPoolStatsCard() {
  const [stats, setStats] = useState<PoolStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [generateLoading, setGenerateLoading] = useState(false)
  const [showDialog, setShowDialog] = useState(false)
  const [keyCount, setKeyCount] = useState(1)
  const [generatedLink, setGeneratedLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const router = useRouter()
  const locale = useLocale()

  useEffect(() => {
    fetch("/api/admin/tinypng-pool/stats")
      .then(async (res) => {
        if (res.ok) {
          const data = await res.json() as PoolStats
          setStats(data)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const handleGenerate = async () => {
    setGenerateLoading(true)
    setError(null)
    try {
      const res = await fetch("/api/tinypng/electron-auth/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: keyCount })
      })
      const data = await res.json() as GenerateResponse
      if (res.ok && data.authLink) {
        setGeneratedLink(data.authLink)
      } else {
        setError(data.error || "Failed to generate link")
      }
    } catch {
      setError("Network error")
    } finally {
      setGenerateLoading(false)
    }
  }

  const handleCopy = async () => {
    if (generatedLink) {
      await navigator.clipboard.writeText(generatedLink)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    }
  }

  const handleOpenDialog = () => {
    setShowDialog(true)
    setGeneratedLink(null)
    setError(null)
    setKeyCount(1)
  }

  if (loading) return null // Or a skeleton

  // Only render if we have stats (implies permission check passed on backend, 
  // though we should also check frontend role ideally, but parent does that or API fails safely)
  if (!stats) return null

  return (
    <>
      <div className="bg-background rounded-lg border-2 border-yellow-500/20 p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Database className="w-5 h-5 text-yellow-500" />
            <h2 className="text-lg font-semibold text-yellow-500">TinyPNG Pool (Emperor Only)</h2>
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="outline" 
              size="sm"
              onClick={handleOpenDialog}
              className="auth-btn"
            >
              <Link className="w-4 h-4 mr-1" />
              Generate Auth Link
            </Button>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => router.push(`/${locale}/profile/tinypng-pool`)}
              className="auth-btn"
            >
              Details
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="p-3 bg-secondary/20 rounded-lg text-center">
              <div className="text-2xl font-bold">{stats.total}</div>
              <div className="text-xs text-muted-foreground">Total</div>
          </div>
          <div className="p-3 bg-green-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-green-600">{stats.active}</div>
              <div className="text-xs text-muted-foreground">Active</div>
          </div>
          <div className="p-3 bg-yellow-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-yellow-600">{stats.pending}</div>
              <div className="text-xs text-muted-foreground">Pending</div>
          </div>
          <div className="p-3 bg-blue-500/10 rounded-lg text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.used}</div>
              <div className="text-xs text-muted-foreground">Used</div>
          </div>
        </div>
      </div>

      <Dialog open={showDialog} onOpenChange={setShowDialog}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Generate Authorization Link</DialogTitle>
            <DialogDescription>
              Generate a link to authorize Electron app users with TinyPNG API keys.
            </DialogDescription>
          </DialogHeader>
          
          {!generatedLink ? (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="keyCount">Number of API Keys</Label>
                <Input
                  id="keyCount"
                  type="number"
                  min={1}
                  max={500}
                  value={keyCount}
                  onChange={(e) => setKeyCount(Math.min(500, Math.max(1, parseInt(e.target.value) || 1)))}
                />
                <p className="text-xs text-muted-foreground">Max: 500 keys</p>
              </div>
              
              {error && (
                <div className="text-sm text-red-500 bg-red-500/10 p-3 rounded-lg">
                  {error}
                </div>
              )}
              
              <Button 
                onClick={handleGenerate} 
                disabled={generateLoading}
                className="w-full"
              >
                {generateLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Generating...
                  </>
                ) : (
                  "Generate Link"
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Authorization Link</Label>
                <div className="flex gap-2">
                  <Input
                    readOnly
                    value={generatedLink}
                    className="font-mono text-xs"
                  />
                  <Button size="icon" variant="outline" onClick={handleCopy}>
                    {copied ? (
                      <Check className="w-4 h-4 text-green-500" />
                    ) : (
                      <Copy className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  This link will expire in 24 hours.
                </p>
              </div>
              
              <Button 
                variant="outline"
                onClick={() => setGeneratedLink(null)}
                className="w-full"
              >
                Generate Another
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
