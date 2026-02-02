"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { useTranslations } from "next-intl"
import { Loader2, ArrowLeft, RefreshCw, Copy, Check, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { useRolePermission } from "@/hooks/use-role-permission"
import { useCopy } from "@/hooks/use-copy"
import { PERMISSIONS } from "@/lib/permissions"
import { useToast } from "@/components/ui/use-toast"

interface PoolItem {
  id: string
  email: string
  apiKey: string | null
  status: 'pending' | 'active' | 'used'
  createdAt: number
  updatedAt: number
}

export default function TinyPngPoolPage() {
  const [items, setItems] = useState<PoolItem[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()
  const { copyToClipboard } = useCopy()
  const { checkPermission } = useRolePermission()
  
  // Assuming if you are here you have permission, but double check
  // or just rely on API failure.
  // Actually checkPermission returns boolean.
  
  const fetchList = async () => {
    try {
      setLoading(true)
      const res = await fetch("/api/admin/tinypng-pool/list")
      if (res.ok) {
        const data = await res.json()
        setItems(data.list)
      } else {
          // Handle error
      }
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetchList()
  }, [])

  const formatDate = (ts: number) => {
    return new Date(ts).toLocaleString()
  }

  return (
    <div className="container max-w-6xl py-8 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold">TinyPNG Pool Details</h1>
        <div className="flex-1" />
        <Button variant="outline" onClick={fetchList} disabled={loading}>
          <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Refresh
        </Button>
      </div>

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
            {loading && items.length === 0 ? (
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
                items.map((item) => (
                    <TableRow key={item.id}>
                        <TableCell className="font-mono text-sm">{item.email}</TableCell>
                        <TableCell>
                            <span className={`px-2 py-1 rounded-full text-xs ${
                                item.status === 'active' ? 'bg-green-100 text-green-700' :
                                item.status === 'pending' ? 'bg-yellow-100 text-yellow-700' :
                                'bg-gray-100 text-gray-700'
                            }`}>
                                {item.status.toUpperCase()}
                            </span>
                        </TableCell>
                        <TableCell className="font-mono text-xs max-w-[200px] truncate">
                            {item.apiKey ? (
                                <div className="flex items-center gap-2 cursor-pointer hover:text-primary" onClick={() => copyToClipboard(item.apiKey!)}>
                                    {item.apiKey.substring(0, 8)}...
                                    <Copy className="w-3 h-3" />
                                </div>
                            ) : '-'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(item.createdAt)}</TableCell>
                        <TableCell className="text-sm text-muted-foreground whitespace-nowrap">{formatDate(item.updatedAt)}</TableCell>
                    </TableRow>
                ))
            )}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
