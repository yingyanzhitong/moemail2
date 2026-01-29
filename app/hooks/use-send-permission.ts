import { useState, useEffect } from 'react'

interface SendPermissionResponse {
  canSend: boolean
  error?: string
  remainingEmails?: number
}

// 模块级缓存，避免重复请求
let cachedPermission: {
  canSend: boolean
  remainingEmails?: number
  error?: string
  timestamp: number
} | null = null

// 缓存有效期：5分钟
const CACHE_TTL = 5 * 60 * 1000

export function useSendPermission() {
  const [canSend, setCanSend] = useState(cachedPermission?.canSend ?? false)
  const [loading, setLoading] = useState(!cachedPermission)
  const [error, setError] = useState<string | null>(cachedPermission?.error ?? null)
  const [remainingEmails, setRemainingEmails] = useState<number | undefined>(cachedPermission?.remainingEmails)

  const checkPermission = async (forceRefresh = false) => {
    // 如果有有效缓存且不强制刷新，直接使用缓存
    if (
      !forceRefresh &&
      cachedPermission &&
      Date.now() - cachedPermission.timestamp < CACHE_TTL
    ) {
      setCanSend(cachedPermission.canSend)
      setRemainingEmails(cachedPermission.remainingEmails)
      setError(cachedPermission.error ?? null)
      setLoading(false)
      return
    }

    setLoading(true)
    setError(null)
    
    try {
      const response = await fetch('/api/emails/send-permission')
      
      if (!response.ok) {
        throw new Error('权限检查失败')
      }

      const data = await response.json() as SendPermissionResponse
      
      // 更新缓存
      cachedPermission = {
        canSend: data.canSend,
        remainingEmails: data.remainingEmails,
        error: data.canSend ? undefined : data.error,
        timestamp: Date.now(),
      }
      
      setCanSend(data.canSend)
      setRemainingEmails(data.remainingEmails)
      
      if (!data.canSend && data.error) {
        setError(data.error)
      }
    } catch (err) {
      setCanSend(false)
      setError(err instanceof Error ? err.message : '权限检查失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    checkPermission()
  }, [])

  return {
    canSend,
    loading,
    error,
    remainingEmails,
    checkPermission: () => checkPermission(true) // 外部调用时强制刷新
  }
}
 