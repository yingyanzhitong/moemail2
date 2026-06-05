"use client"

import { create } from "zustand"
import { Role, ROLES } from "@/lib/permissions"
import { useEffect } from "react"
import { resolveRoleMaxEmails, type RoleEmailLimitConfig } from "@/lib/email-limits"
import {
  resolveRoleTinyPngDailyLimits,
  resolveRoleTinyPngPerRequestLimits,
  type RoleTinyPngDailyLimitConfig,
  type RoleTinyPngPerRequestLimitConfig,
} from "@/lib/tinypng-limits"

export interface AppConfig {
  defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
  emailDomains: string
  emailDomainsArray: string[]
  adminContact: string
  maxEmails: number
  roleMaxEmails: RoleEmailLimitConfig
  tinypngDailyLimits: RoleTinyPngDailyLimitConfig
  tinypngPerRequestLimits: RoleTinyPngPerRequestLimitConfig
}

interface ConfigResponse {
  defaultRole: Exclude<Role, typeof ROLES.EMPEROR>
  emailDomains: string
  adminContact: string
  maxEmails?: string | number
  roleMaxEmails?: Partial<RoleEmailLimitConfig>
  tinypngDailyLimits?: Partial<RoleTinyPngDailyLimitConfig>
  tinypngPerRequestLimits?: Partial<RoleTinyPngPerRequestLimitConfig>
}

interface ConfigStore {
  config: AppConfig | null
  loading: boolean
  error: string | null
  fetch: () => Promise<void>
}

const useConfigStore = create<ConfigStore>((set) => ({
  config: null,
  loading: false,
  error: null,
  fetch: async () => {
    try {
      set({ loading: true, error: null })
      const res = await fetch("/api/config")
      if (!res.ok) throw new Error("获取配置失败")
      const data = (await res.json()) as ConfigResponse
      const roleMaxEmails = resolveRoleMaxEmails(data.roleMaxEmails, data.maxEmails)
      const tinypngDailyLimits = resolveRoleTinyPngDailyLimits(data.tinypngDailyLimits)
      const tinypngPerRequestLimits = resolveRoleTinyPngPerRequestLimits(
        data.tinypngPerRequestLimits,
      )

      set({
        config: {
          defaultRole: data.defaultRole || ROLES.CIVILIAN,
          emailDomains: data.emailDomains,
          emailDomainsArray: data.emailDomains.split(","),
          adminContact: data.adminContact || "",
          maxEmails: roleMaxEmails.civilian,
          roleMaxEmails,
          tinypngDailyLimits,
          tinypngPerRequestLimits,
        },
        loading: false,
      })
    } catch (error) {
      set({
        error: error instanceof Error ? error.message : "获取配置失败",
        loading: false,
      })
    }
  },
}))

export function useConfig() {
  const store = useConfigStore()

  const { config, loading, fetch } = store

  useEffect(() => {
    if (!config && !loading) {
      fetch()
    }
  }, [config, loading, fetch])

  return store
}
