import { useEffect, useState } from "react"
import { useTranslations } from "next-intl"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Loader2, ArrowLeft } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useRouter } from "next/navigation"

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Activity } from "lucide-react"

interface UserStat {
  id: string
  name: string
  username: string
  email: string
  image: string
  role: string
  joinedAt: string
  emailCount: number
  tinypngCount: number
  apiUsage: { endpoint: string, count: number }[]
}

export function UserList() {
  const t = useTranslations("profile.users")
  const [users, setUsers] = useState<UserStat[]>([])
  const [loading, setLoading] = useState(true)
  const router = useRouter()

  useEffect(() => {
    fetchUsers()
  }, [])

  const fetchUsers = async () => {
    try {
      const res = await fetch("/api/admin/users")
      if (!res.ok) throw new Error("Failed to fetch")
      const data = await res.json() as { users: UserStat[] }
      setUsers(data.users || [])
    } catch (error) {
      console.error(error)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center p-8">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => router.back()}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <h1 className="text-2xl font-bold">{t("title")}</h1>
      </div>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("username")}</TableHead>
              <TableHead>{t("email")}</TableHead>
              <TableHead>{t("role")}</TableHead>
              <TableHead>{t("joinedAt")}</TableHead>
              <TableHead className="text-right">{t("emailCount")}</TableHead>
              <TableHead className="text-right">{t("tinypngCount")}</TableHead>
              <TableHead className="text-right">{t("apiUsage")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {users.map((user) => (
              <TableRow key={user.id}>
                <TableCell className="font-medium">{user.username || user.name}</TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{t(`roles.${user.role}`)}</TableCell>
                <TableCell>
                  {user.joinedAt ? new Date(user.joinedAt).toLocaleDateString() : "-"}
                </TableCell>
                <TableCell className="text-right">{user.emailCount}</TableCell>
                <TableCell className="text-right">{user.tinypngCount}</TableCell>
                <TableCell className="text-right">
                    {user.apiUsage.length > 0 ? (
                        <Popover>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                    <Activity className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent className="w-80">
                                <div className="space-y-2">
                                    <h4 className="font-medium leading-none mb-2">{t("apiUsageTitle")}</h4>
                                    {user.apiUsage.map((stat, i) => (
                                        <div key={i} className="flex justify-between text-sm">
                                            <span className="text-muted-foreground truncate max-w-[200px]" title={stat.endpoint}>
                                                {stat.endpoint}
                                            </span>
                                            <span className="font-mono">{stat.count}</span>
                                        </div>
                                    ))}
                                </div>
                            </PopoverContent>
                        </Popover>
                    ) : (
                        <span className="text-muted-foreground">-</span>
                    )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  )
}
