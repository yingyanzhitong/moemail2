"use client"

import { useCallback } from "react"
import { useToast } from "@/components/ui/use-toast"

interface UseCopyOptions {
  successMessage?: string
  errorMessage?: string
}

export function useCopy(options: UseCopyOptions = {}) {
  const { toast } = useToast()
  const {
    successMessage = "已复制到剪贴板",
    errorMessage = "复制失败"
  } = options

  const copyToClipboard = useCallback(async (text: string) => {
    try {
      if (navigator.clipboard) {
        await navigator.clipboard.writeText(text)
      } else {
        const textArea = document.createElement("textarea")
        textArea.value = text
        document.body.appendChild(textArea)
        textArea.select()
        try {
          document.execCommand('copy')
        } catch (err) {
          console.error("Fallback copy failed", err)
          throw new Error("Copy failed")
        }
        document.body.removeChild(textArea)
      }
      toast({
        title: "成功",
        description: successMessage
      })
      return true
    } catch (err) {
      console.error(err)
      toast({
        title: "错误",
        description: errorMessage,
        variant: "destructive"
      })
      return false
    }
  }, [successMessage, errorMessage, toast])

  return {
    copyToClipboard
  }
}