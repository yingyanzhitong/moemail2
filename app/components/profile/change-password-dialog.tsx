"use client"

import { useState } from "react"
import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { Loader2, Lock } from "lucide-react"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"

export function ChangePasswordDialog() {
  const t = useTranslations("profile.password")
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const { toast } = useToast()

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    
    if (newPassword !== confirmPassword) {
      toast({
        title: t("failed"),
        description: t("confirm")
      })
      return
    }

    setLoading(true)
    try {
      const res = await fetch("/api/auth/password", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ 
          currentPassword,
          newPassword,
          confirmPassword
        })
      })

      const data = await res.json() as { error?: string }

      if (!res.ok) throw new Error(data.error || t("failed"))

      toast({
        title: t("success"),
        description: t("success")
      })
      
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setOpen(false)
      
    } catch (error) {
      toast({
        title: t("failed"),
        description: error instanceof Error ? error.message : t("failed"),
        variant: "destructive"
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
            variant="outline" 
            size="sm" 
            className="h-6 gap-1 px-2 text-xs border-primary/20 hover:border-primary/50 text-primary hover:text-primary hover:bg-primary/5"
        >
          <Lock className="w-3 h-3" />
          <span>{t("title")}</span>
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
          <DialogDescription>
            {t("description")}
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
                <Label htmlFor="current-password">{t("current")}</Label>
                <Input
                    id="current-password"
                    type="password"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                />
            </div>
            
            <div className="space-y-2">
                <Label htmlFor="new-password">{t("new")}</Label>
                <Input
                    id="new-password"
                    type="password"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={8}
                />
            </div>

            <div className="space-y-2">
                <Label htmlFor="confirm-password">{t("confirm")}</Label>
                <Input
                    id="confirm-password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    required
                    minLength={8}
                />
            </div>

            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                    {/* Reuse cancel text if available, or just Cancel */}
                    取消
                </Button>
                <Button type="submit" disabled={loading}>
                    {loading ? (
                        <>
                            <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                            {t("saving")}
                        </>
                    ) : (
                        t("save")
                    )}
                </Button>
            </div>
        </form>
      </DialogContent>
    </Dialog>
  )
}
