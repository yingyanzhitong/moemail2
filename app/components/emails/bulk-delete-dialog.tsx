"use client"

import { useMemo, useState } from "react"
import { useTranslations } from "next-intl"
import { Trash2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { useToast } from "@/components/ui/use-toast"
import { cn } from "@/lib/utils"

const DAY_IN_MS = 24 * 60 * 60 * 1000
const QUICK_OPTIONS = [
  { value: 30, translationKey: "bulkDeleteThirtyDays" },
  { value: 90, translationKey: "bulkDeleteNinetyDays" },
] as const

interface EmailMeta {
  id: string
  createdAt: number
}

interface BulkDeleteDialogProps {
  emails: EmailMeta[]
  selectedEmailId?: string
  onDeleted: (payload: { selectedEmailDeleted: boolean }) => Promise<void> | void
}

export function BulkDeleteDialog({
  emails,
  selectedEmailId,
  onDeleted,
}: BulkDeleteDialogProps) {
  const t = useTranslations("emails.list")
  const tCommon = useTranslations("common.actions")
  const { toast } = useToast()
  const [open, setOpen] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [selectedDays, setSelectedDays] = useState<number>(QUICK_OPTIONS[0].value)
  const [customDays, setCustomDays] = useState("")

  const effectiveDays = useMemo(() => {
    if (selectedDays !== -1) {
      return selectedDays
    }

    const parsedDays = Number.parseInt(customDays, 10)
    return Number.isFinite(parsedDays) ? parsedDays : NaN
  }, [customDays, selectedDays])

  const resetState = () => {
    setSelectedDays(QUICK_OPTIONS[0].value)
    setCustomDays("")
    setDeleting(false)
  }

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen)
    if (!nextOpen) {
      resetState()
    }
  }

  const handleConfirm = async () => {
    if (!Number.isInteger(effectiveDays) || effectiveDays <= 0) {
      toast({
        title: t("error"),
        description: t("bulkDeleteInvalidDays"),
        variant: "destructive",
      })
      return
    }

    const cutoffTimestamp = Date.now() - effectiveDays * DAY_IN_MS
    const selectedEmailDeleted = Boolean(
      selectedEmailId &&
        emails.some((email) => email.id === selectedEmailId && email.createdAt < cutoffTimestamp)
    )

    setDeleting(true)

    try {
      const response = await fetch("/api/emails", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ olderThanDays: effectiveDays }),
      })

      const data = (await response.json()) as { deletedCount?: number; error?: string }

      if (!response.ok) {
        toast({
          title: t("error"),
          description: data.error || t("bulkDeleteFailed"),
          variant: "destructive",
        })
        return
      }

      if (!data.deletedCount) {
        toast({
          title: t("success"),
          description: t("bulkDeleteNoMatch"),
        })
        handleOpenChange(false)
        return
      }

      await onDeleted({ selectedEmailDeleted })

      toast({
        title: t("success"),
        description: t("bulkDeleteSuccess", { count: data.deletedCount }),
      })

      handleOpenChange(false)
    } catch {
      toast({
        title: t("error"),
        description: t("bulkDeleteFailed"),
        variant: "destructive",
      })
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 shrink-0 border border-primary/20"
          aria-label={t("bulkDeleteButton")}
          title={t("bulkDeleteButton")}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t("bulkDeleteTitle")}</DialogTitle>
          <DialogDescription>{t("bulkDeleteDescription")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {QUICK_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                className={cn(
                  "rounded-lg border px-4 py-3 text-left text-sm transition-colors",
                  selectedDays === option.value
                    ? "border-destructive bg-destructive/5 text-foreground"
                    : "border-primary/15 hover:border-primary/30 hover:bg-primary/5"
                )}
                onClick={() => setSelectedDays(option.value)}
              >
                <span className="block font-medium">{t(option.translationKey)}</span>
                <span className="mt-1 block text-xs text-muted-foreground">
                  {t("bulkDeleteOlderThan", { days: option.value })}
                </span>
              </button>
            ))}
          </div>

          <div
            className={cn(
              "rounded-lg border p-4 transition-colors",
              selectedDays === -1
                ? "border-destructive bg-destructive/5"
                : "border-primary/15 bg-muted/20"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-1">
                <Label htmlFor="bulk-delete-custom-days">{t("bulkDeleteCustomDaysTitle")}</Label>
                <p className="text-xs text-muted-foreground">{t("bulkDeleteCustomDaysHint")}</p>
              </div>
              <Button
                type="button"
                variant={selectedDays === -1 ? "default" : "outline"}
                className="shrink-0"
                onClick={() => setSelectedDays(-1)}
              >
                {t("bulkDeleteCustomDaysAction")}
              </Button>
            </div>
            <Input
              id="bulk-delete-custom-days"
              type="number"
              min={1}
              step={1}
              value={customDays}
              onFocus={() => setSelectedDays(-1)}
              onChange={(event) => {
                setSelectedDays(-1)
                setCustomDays(event.target.value)
              }}
              placeholder={t("bulkDeleteCustomDaysPlaceholder")}
              className="mt-3"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => handleOpenChange(false)} disabled={deleting}>
            {tCommon("cancel")}
          </Button>
          <Button
            onClick={handleConfirm}
            disabled={deleting}
            className="bg-destructive hover:bg-destructive/90"
          >
            {deleting ? t("bulkDeleting") : tCommon("delete")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
