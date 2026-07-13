"use client"

import { useTranslations } from "next-intl"
import { Button } from "@/components/ui/button"
import { Settings } from "lucide-react"
import { useToast } from "@/components/ui/use-toast"
import { useState, useEffect } from "react"
import { Role, ROLES } from "@/lib/permissions"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Label } from "@/components/ui/label"
import { Eye, EyeOff } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DEFAULT_ROLE_MAX_ACTIVE_EMAILS,
  resolveRoleMaxEmails,
  type RoleEmailLimitConfig,
} from "@/lib/email-limits"
import {
  DEFAULT_TINYPNG_DAILY_LIMITS,
  DEFAULT_TINYPNG_PER_REQUEST_LIMITS,
  resolveRoleTinyPngDailyLimits,
  resolveRoleTinyPngPerRequestLimits,
  type RoleTinyPngDailyLimitConfig,
  type RoleTinyPngPerRequestLimitConfig,
} from "@/lib/tinypng-limits"

interface WebsiteConfigResponse {
  defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
  emailDomains: string
  tinypngPoolEmailDomain: string
  adminContact: string
  maxEmails?: string | number
  roleMaxEmails?: Partial<RoleEmailLimitConfig>
  tinypngDailyLimits?: Partial<RoleTinyPngDailyLimitConfig>
  tinypngPerRequestLimits?: Partial<RoleTinyPngPerRequestLimitConfig>
  turnstile?: {
    enabled: boolean
    siteKey: string
    secretKey?: string
  }
}

interface RoleMaxEmailFormState {
  duke: string
  knight: string
  civilian: string
}

interface RoleTinyPngDailyLimitFormState {
  duke: string
  knight: string
  civilian: string
}

interface RoleTinyPngPerRequestLimitFormState {
  emperor: string
  duke: string
  knight: string
  civilian: string
}

function createRoleMaxEmailFormState(
  roleMaxEmails?: Partial<RoleEmailLimitConfig>,
  maxEmails?: string | number,
): RoleMaxEmailFormState {
  const resolvedRoleMaxEmails = resolveRoleMaxEmails(roleMaxEmails, maxEmails)

  return {
    duke: resolvedRoleMaxEmails.duke.toString(),
    knight: resolvedRoleMaxEmails.knight.toString(),
    civilian: resolvedRoleMaxEmails.civilian.toString(),
  }
}

function createRoleTinyPngDailyLimitFormState(
  roleLimits?: Partial<RoleTinyPngDailyLimitConfig>,
): RoleTinyPngDailyLimitFormState {
  const resolvedRoleLimits = resolveRoleTinyPngDailyLimits(roleLimits)

  return {
    duke: resolvedRoleLimits.duke.toString(),
    knight: resolvedRoleLimits.knight.toString(),
    civilian: resolvedRoleLimits.civilian.toString(),
  }
}

function createRoleTinyPngPerRequestLimitFormState(
  roleLimits?: Partial<RoleTinyPngPerRequestLimitConfig>,
): RoleTinyPngPerRequestLimitFormState {
  const resolvedRoleLimits = resolveRoleTinyPngPerRequestLimits(roleLimits)

  return {
    emperor: resolvedRoleLimits.emperor.toString(),
    duke: resolvedRoleLimits.duke.toString(),
    knight: resolvedRoleLimits.knight.toString(),
    civilian: resolvedRoleLimits.civilian.toString(),
  }
}

export function WebsiteConfigPanel() {
  const t = useTranslations("profile.website")
  const tCard = useTranslations("profile.card")
  const [defaultRole, setDefaultRole] = useState<string>("")
  const [emailDomains, setEmailDomains] = useState<string>("")
  const [tinypngPoolEmailDomain, setTinypngPoolEmailDomain] = useState<string>("")
  const [adminContact, setAdminContact] = useState<string>("")
  const [roleMaxEmails, setRoleMaxEmails] = useState<RoleMaxEmailFormState>(() =>
    createRoleMaxEmailFormState(DEFAULT_ROLE_MAX_ACTIVE_EMAILS),
  )
  const [tinypngDailyLimits, setTinypngDailyLimits] =
    useState<RoleTinyPngDailyLimitFormState>(() =>
      createRoleTinyPngDailyLimitFormState(DEFAULT_TINYPNG_DAILY_LIMITS),
    )
  const [tinypngPerRequestLimits, setTinypngPerRequestLimits] =
    useState<RoleTinyPngPerRequestLimitFormState>(() =>
      createRoleTinyPngPerRequestLimitFormState(DEFAULT_TINYPNG_PER_REQUEST_LIMITS),
    )
  const [turnstileEnabled, setTurnstileEnabled] = useState(false)
  const [turnstileSiteKey, setTurnstileSiteKey] = useState("")
  const [turnstileSecretKey, setTurnstileSecretKey] = useState("")
  const [showSecretKey, setShowSecretKey] = useState(false)
  const [loading, setLoading] = useState(false)
  const { toast } = useToast()

  useEffect(() => {
    void fetchConfig()
  }, [])

  const fetchConfig = async () => {
    const res = await fetch("/api/config")
    if (res.ok) {
      const data = (await res.json()) as WebsiteConfigResponse
      setDefaultRole(data.defaultRole)
      setEmailDomains(data.emailDomains)
      setTinypngPoolEmailDomain(data.tinypngPoolEmailDomain)
      setAdminContact(data.adminContact)
      setRoleMaxEmails(createRoleMaxEmailFormState(data.roleMaxEmails, data.maxEmails))
      setTinypngDailyLimits(createRoleTinyPngDailyLimitFormState(data.tinypngDailyLimits))
      setTinypngPerRequestLimits(
        createRoleTinyPngPerRequestLimitFormState(data.tinypngPerRequestLimits),
      )
      setTurnstileEnabled(Boolean(data.turnstile?.enabled))
      setTurnstileSiteKey(data.turnstile?.siteKey ?? "")
      setTurnstileSecretKey(data.turnstile?.secretKey ?? "")
    }
  }

  const handleRoleLimitChange = (role: keyof RoleMaxEmailFormState, value: string) => {
    setRoleMaxEmails((prev) => ({
      ...prev,
      [role]: value,
    }))
  }

  const emailDomainOptions = emailDomains
    .split(",")
    .map((domain) => domain.trim())
    .filter(Boolean)

  const handleEmailDomainsChange = (value: string) => {
    const nextDomainOptions = value
      .split(",")
      .map((domain) => domain.trim())
      .filter(Boolean)

    setEmailDomains(value)
    if (!nextDomainOptions.includes(tinypngPoolEmailDomain)) {
      setTinypngPoolEmailDomain(nextDomainOptions[0] ?? "")
    }
  }

  const handleTinypngDailyLimitChange = (
    role: keyof RoleTinyPngDailyLimitFormState,
    value: string,
  ) => {
    setTinypngDailyLimits((prev) => ({
      ...prev,
      [role]: value,
    }))
  }

  const handleTinypngPerRequestLimitChange = (
    role: keyof RoleTinyPngPerRequestLimitFormState,
    value: string,
  ) => {
    setTinypngPerRequestLimits((prev) => ({
      ...prev,
      [role]: value,
    }))
  }

  const handleSave = async () => {
    setLoading(true)
    try {
      const resolvedRoleMaxEmails = resolveRoleMaxEmails(roleMaxEmails, roleMaxEmails.civilian)
      const resolvedTinyPngDailyLimits = resolveRoleTinyPngDailyLimits(tinypngDailyLimits)
      const resolvedTinyPngPerRequestLimits =
        resolveRoleTinyPngPerRequestLimits(tinypngPerRequestLimits)
      const res = await fetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          defaultRole,
          emailDomains,
          tinypngPoolEmailDomain,
          adminContact,
          roleMaxEmails: resolvedRoleMaxEmails,
          tinypngDailyLimits: resolvedTinyPngDailyLimits,
          tinypngPerRequestLimits: resolvedTinyPngPerRequestLimits,
          turnstile: {
            enabled: turnstileEnabled,
            siteKey: turnstileSiteKey,
            secretKey: turnstileSecretKey,
          },
        }),
      })

      if (!res.ok) throw new Error(t("saveFailed"))

      setRoleMaxEmails(createRoleMaxEmailFormState(resolvedRoleMaxEmails))
      setTinypngDailyLimits(createRoleTinyPngDailyLimitFormState(resolvedTinyPngDailyLimits))
      setTinypngPerRequestLimits(
        createRoleTinyPngPerRequestLimitFormState(resolvedTinyPngPerRequestLimits),
      )
      toast({
        title: t("saveSuccess"),
        description: t("saveSuccess"),
      })
    } catch (error) {
      toast({
        title: t("saveFailed"),
        description: error instanceof Error ? error.message : t("saveFailed"),
        variant: "destructive",
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="bg-background rounded-lg border-2 border-primary/20 p-6">
      <div className="flex items-center gap-2 mb-6">
        <Settings className="w-5 h-5 text-primary" />
        <h2 className="text-lg font-semibold">{t("title")}</h2>
      </div>

      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <span className="text-sm">{t("defaultRole")}:</span>
          <Select value={defaultRole} onValueChange={setDefaultRole}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ROLES.DUKE}>{tCard("roles.DUKE")}</SelectItem>
              <SelectItem value={ROLES.KNIGHT}>{tCard("roles.KNIGHT")}</SelectItem>
              <SelectItem value={ROLES.CIVILIAN}>{tCard("roles.CIVILIAN")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm">{t("emailDomains")}:</span>
          <div className="flex-1">
            <Input
              value={emailDomains}
              onChange={(e) => handleEmailDomainsChange(e.target.value)}
              placeholder={t("emailDomainsPlaceholder")}
            />
          </div>
        </div>

        <div className="flex items-start gap-4">
          <span className="pt-2 text-sm">{t("tinypngPoolEmailDomain")}:</span>
          <div className="flex-1 space-y-2">
            <Select
              value={tinypngPoolEmailDomain}
              onValueChange={setTinypngPoolEmailDomain}
              disabled={emailDomainOptions.length === 0}
            >
              <SelectTrigger>
                <SelectValue placeholder={t("tinypngPoolEmailDomainPlaceholder")} />
              </SelectTrigger>
              <SelectContent>
                {emailDomainOptions.map((domain) => (
                  <SelectItem key={domain} value={domain}>
                    @{domain}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              {t("tinypngPoolEmailDomainDescription")}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-4">
          <span className="text-sm">{t("adminContact")}:</span>
          <div className="flex-1">
            <Input
              value={adminContact}
              onChange={(e) => setAdminContact(e.target.value)}
              placeholder={t("adminContactPlaceholder")}
            />
          </div>
        </div>

        <div className="flex items-start gap-4">
          <span className="pt-2 text-sm">{t("maxEmails")}:</span>
          <div className="flex-1 space-y-3">
            <p className="text-xs text-muted-foreground">{t("maxEmailsDescription")}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="duke-max-emails" className="text-sm font-medium">
                  {tCard("roles.DUKE")}
                </Label>
                <Input
                  id="duke-max-emails"
                  type="number"
                  min="1"
                  value={roleMaxEmails.duke}
                  onChange={(e) => handleRoleLimitChange("duke", e.target.value)}
                  placeholder={DEFAULT_ROLE_MAX_ACTIVE_EMAILS.duke.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="knight-max-emails" className="text-sm font-medium">
                  {tCard("roles.KNIGHT")}
                </Label>
                <Input
                  id="knight-max-emails"
                  type="number"
                  min="1"
                  value={roleMaxEmails.knight}
                  onChange={(e) => handleRoleLimitChange("knight", e.target.value)}
                  placeholder={DEFAULT_ROLE_MAX_ACTIVE_EMAILS.knight.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="civilian-max-emails" className="text-sm font-medium">
                  {tCard("roles.CIVILIAN")}
                </Label>
                <Input
                  id="civilian-max-emails"
                  type="number"
                  min="1"
                  value={roleMaxEmails.civilian}
                  onChange={(e) => handleRoleLimitChange("civilian", e.target.value)}
                  placeholder={DEFAULT_ROLE_MAX_ACTIVE_EMAILS.civilian.toString()}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <span className="pt-2 text-sm">{t("tinypngDailyLimits")}:</span>
          <div className="flex-1 space-y-3">
            <p className="text-xs text-muted-foreground">{t("tinypngDailyLimitsDescription")}</p>
            <div className="grid gap-3 md:grid-cols-3">
              <div className="space-y-2">
                <Label htmlFor="duke-tinypng-daily-limit" className="text-sm font-medium">
                  {tCard("roles.DUKE")}
                </Label>
                <Input
                  id="duke-tinypng-daily-limit"
                  type="number"
                  min="0"
                  value={tinypngDailyLimits.duke}
                  onChange={(e) => handleTinypngDailyLimitChange("duke", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_DAILY_LIMITS.duke.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="knight-tinypng-daily-limit" className="text-sm font-medium">
                  {tCard("roles.KNIGHT")}
                </Label>
                <Input
                  id="knight-tinypng-daily-limit"
                  type="number"
                  min="0"
                  value={tinypngDailyLimits.knight}
                  onChange={(e) => handleTinypngDailyLimitChange("knight", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_DAILY_LIMITS.knight.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="civilian-tinypng-daily-limit" className="text-sm font-medium">
                  {tCard("roles.CIVILIAN")}
                </Label>
                <Input
                  id="civilian-tinypng-daily-limit"
                  type="number"
                  min="0"
                  value={tinypngDailyLimits.civilian}
                  onChange={(e) => handleTinypngDailyLimitChange("civilian", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_DAILY_LIMITS.civilian.toString()}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="flex items-start gap-4">
          <span className="pt-2 text-sm">{t("tinypngPerRequestLimits")}:</span>
          <div className="flex-1 space-y-3">
            <p className="text-xs text-muted-foreground">
              {t("tinypngPerRequestLimitsDescription")}
            </p>
            <div className="grid gap-3 md:grid-cols-4">
              <div className="space-y-2">
                <Label htmlFor="emperor-tinypng-per-request-limit" className="text-sm font-medium">
                  {tCard("roles.EMPEROR")}
                </Label>
                <Input
                  id="emperor-tinypng-per-request-limit"
                  type="number"
                  min="0"
                  value={tinypngPerRequestLimits.emperor}
                  onChange={(e) => handleTinypngPerRequestLimitChange("emperor", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_PER_REQUEST_LIMITS.emperor.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="duke-tinypng-per-request-limit" className="text-sm font-medium">
                  {tCard("roles.DUKE")}
                </Label>
                <Input
                  id="duke-tinypng-per-request-limit"
                  type="number"
                  min="0"
                  value={tinypngPerRequestLimits.duke}
                  onChange={(e) => handleTinypngPerRequestLimitChange("duke", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_PER_REQUEST_LIMITS.duke.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="knight-tinypng-per-request-limit" className="text-sm font-medium">
                  {tCard("roles.KNIGHT")}
                </Label>
                <Input
                  id="knight-tinypng-per-request-limit"
                  type="number"
                  min="0"
                  value={tinypngPerRequestLimits.knight}
                  onChange={(e) => handleTinypngPerRequestLimitChange("knight", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_PER_REQUEST_LIMITS.knight.toString()}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="civilian-tinypng-per-request-limit" className="text-sm font-medium">
                  {tCard("roles.CIVILIAN")}
                </Label>
                <Input
                  id="civilian-tinypng-per-request-limit"
                  type="number"
                  min="0"
                  value={tinypngPerRequestLimits.civilian}
                  onChange={(e) => handleTinypngPerRequestLimitChange("civilian", e.target.value)}
                  placeholder={DEFAULT_TINYPNG_PER_REQUEST_LIMITS.civilian.toString()}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 rounded-lg border border-dashed border-primary/40 p-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="turnstile-enabled" className="text-sm font-medium">
                {t("turnstile.enable")}
              </Label>
              <p className="text-xs text-muted-foreground">
                {t("turnstile.enableDescription")}
              </p>
            </div>
            <Switch
              id="turnstile-enabled"
              checked={turnstileEnabled}
              onCheckedChange={setTurnstileEnabled}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="turnstile-site-key" className="text-sm font-medium">
              {t("turnstile.siteKey")}
            </Label>
            <Input
              id="turnstile-site-key"
              value={turnstileSiteKey}
              onChange={(e) => setTurnstileSiteKey(e.target.value)}
              placeholder={t("turnstile.siteKeyPlaceholder")}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="turnstile-secret-key" className="text-sm font-medium">
              {t("turnstile.secretKey")}
            </Label>
            <div className="relative">
              <Input
                id="turnstile-secret-key"
                type={showSecretKey ? "text" : "password"}
                value={turnstileSecretKey}
                onChange={(e) => setTurnstileSecretKey(e.target.value)}
                placeholder={t("turnstile.secretKeyPlaceholder")}
              />
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                onClick={() => setShowSecretKey((prev) => !prev)}
              >
                {showSecretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              {t("turnstile.secretKeyDescription")}
            </p>
          </div>
        </div>

        <Button onClick={handleSave} disabled={loading} className="w-full">
          {loading ? t("saving") : t("save")}
        </Button>
      </div>
    </div>
  )
}
