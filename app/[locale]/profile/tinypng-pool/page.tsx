"use client"

import { useState, useEffect, useRef } from "react"
import { useRouter } from "next/navigation"
import { Loader2, ArrowLeft, RefreshCw, Copy } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useCopy } from "@/hooks/use-copy"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
import { DesktopLicenseAdmin } from "@/components/profile/desktop-license-admin"

interface PoolItem {
  id: string
  email: string
  apiKey: string | null
  status: 'pending' | 'active' | 'reserved' | 'assigned' | 'invalid' | 'used' | 'registered' | 'link_received' | 'registration_failed'
  errorMessage?: string | null
  createdAt: number
  updatedAt: number
}

export default function TinyPngPoolPage() {
  const [items, setItems] = useState<PoolItem[]>([])
  const [loading, setLoading] = useState(false)
  const [hasMore, setHasMore] = useState(true)
  const observerTarget = useRef<HTMLDivElement>(null)
  const router = useRouter()
  const { copyToClipboard } = useCopy()
  
  const fetchList = async (isRefresh = false) => {
    try {
      setLoading(true)
      const offset = isRefresh ? 0 : items.length
      const res = await fetch(`/api/admin/tinypng-pool/list?limit=100&offset=${offset}`)
      
      if (res.ok) {
        const data = await res.json() as { list: PoolItem[] }
        if (data.list.length < 100) {
          setHasMore(false)
        } else {
            setHasMore(true)
        }
        
        if (isRefresh) {
          setItems(data.list)
        } else {
          setItems(prev => [...prev, ...data.list])
        }
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList(true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const currentTarget = observerTarget.current
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loading) {
          fetchList()
        }
      },
      { threshold: 1.0 }
    )

    if (currentTarget) {
      observer.observe(currentTarget)
    }

    return () => {
      if (currentTarget) {
        observer.unobserve(currentTarget)
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasMore, loading, items.length])

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString()
  }

  const handleRefresh = () => {
      setHasMore(true)
      fetchList(true)
  }

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold">TinyPNG Pool Details</h1>
        <div className="flex-1" />
        <Button variant="outline" onClick={handleRefresh} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

      <DesktopLicenseAdmin />

      <div className="border rounded-lg bg-background">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Email</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>API Key</TableHead>
              <TableHead>Created At</TableHead>
              <TableHead>Updated At</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {items.length === 0 && loading ? (
               <TableRow>
                 <TableCell colSpan={5} className="h-24 text-center">
                   <div className="flex justify-center items-center gap-2">
                     <Loader2 className="w-4 h-4 animate-spin" />
                     Loading...
                   </div>
                 </TableCell>
               </TableRow>
            ) : items.length === 0 ? (
                <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center">
                        No records found.
                    </TableCell>
                </TableRow>
            ) : (
                <>

                {items.map((item) => (
                    <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.email}</TableCell>
                        <TableCell>
                            <div className="flex flex-col gap-1">
                                <span className={`px-2 py-1 rounded-full text-xs w-fit ${
                                    item.status === 'active' ? 'bg-green-100 text-green-700' :
                                    item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                    item.status === 'registration_failed' ? 'bg-red-100 text-red-700' :
                                    'bg-gray-100 text-gray-700'
                                }`}>
                                    {item.status.toUpperCase()}
                                </span>
                                {item.status === 'registration_failed' && item.errorMessage && (
                                    <TooltipProvider>
                                        <Tooltip>
                                            <TooltipTrigger asChild>
                                                <span className="text-[10px] text-red-500 max-w-[200px] truncate cursor-help hover:underline decoration-dotted">
                                                    {item.errorMessage}
                                                </span>
                                            </TooltipTrigger>
                                            <TooltipContent className="max-w-[300px] break-all">
                                                <p>{item.errorMessage}</p>
                                            </TooltipContent>
                                        </Tooltip>
                                    </TooltipProvider>
                                )}
                            </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">
                            {item.apiKey ? (
                                <button type="button" className="flex items-center gap-2 cursor-pointer hover:text-primary bg-transparent border-0 p-0" onClick={() => copyToClipboard(item.apiKey!)}>
                                    {item.apiKey.substring(0, 8)}...
                                    <Copy className="w-3 h-3" />
                                </button>
                            ) : '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(item.createdAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(item.updatedAt)}</TableCell>
                    </TableRow>
                ))}
                {/* Sentinel for infinite scroll */}
                <TableRow>
                   <TableCell colSpan={5} className="p-0 border-0">
                       <div ref={observerTarget} className="h-4 w-full" />
                       {loading && items.length > 0 && (
                           <div className="flex justify-center items-center py-4 text-muted-foreground text-sm">
                               <Loader2 className="w-4 h-4 animate-spin mr-2" />
                               Loading more...
                           </div>
                       )}
                   </TableCell>
                </TableRow>
                </>
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
