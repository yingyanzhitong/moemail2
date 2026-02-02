"use client"

import { useEffect, useState } from "react"
import { Database } from "lucide-react"
import { useRouter } from "next/navigation"
import { useLocale } from "next-intl"
import { Button } from "@/components/ui/button"

interface PoolStats {
  total: number
  active: number
  pending: number
  used: number
}

export function TinyPngPoolStatsCard() {
  const [stats, setStats] = useState<PoolStats | null>(null)
  const [loading, setLoading] = useState(true)
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

  if (loading) return null // Or a skeleton

  // Only render if we have stats (implies permission check passed on backend, 
  // though we should also check frontend role ideally, but parent does that or API fails safely)
  if (!stats) return null

  return (
    <div className="bg-background rounded-lg border-2 border-yellow-500/20 p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Database className="w-5 h-5 text-yellow-500" />
          <h2 className="text-lg font-semibold text-yellow-500">TinyPNG Pool (Emperor Only)</h2>
        </div>
        <Button 
          variant="outline" 
          size="sm"
          onClick={() => router.push(`/${locale}/profile/tinypng-pool`)}
          className="auth-btn"
        >
          Details
        </Button>
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
  )
}
