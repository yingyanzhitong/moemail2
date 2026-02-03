import { ipcMain } from 'electron'
import { getActiveApiKeys, updateApiKeyUsage } from '../db'

interface TinyPngResponse {
  input: { size: number; type: string }
  output: { 
    size: number
    type: string
    ratio: number
    url: string 
  }
}

// TinyPNG API usage check - returns remaining compressions for a key
async function checkKeyUsage(apiKey: string): Promise<{ used: number; remaining: number } | null> {
  try {
    // TinyPNG returns usage in the response headers after any API call
    // We'll do a minimal request to check usage
    const response = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({}) // Empty body will fail but return headers
    })
    
    // TinyPNG returns compression count even on error responses
    const compressionCount = response.headers.get('compression-count')
    if (compressionCount) {
      const used = parseInt(compressionCount, 10)
      return { 
        used, 
        remaining: 500 - used // TinyPNG free tier: 500/month
      }
    }
    
    return null
  } catch {
    return null
  }
}

// Compress image using TinyPNG API
async function compressImage(
  apiKey: string, 
  imageBuffer: Buffer
): Promise<{ success: boolean; data?: Buffer; originalSize: number; compressedSize?: number; error?: string }> {
  try {
    const originalSize = imageBuffer.length
    
    // Upload image to TinyPNG
    const uploadResponse = await fetch('https://api.tinify.com/shrink', {
      method: 'POST',
      headers: {
        'Authorization': `Basic ${Buffer.from(`api:${apiKey}`).toString('base64')}`
      },
      body: imageBuffer
    })
    
    if (!uploadResponse.ok) {
      const errorData = await uploadResponse.json().catch(() => ({})) as { error?: string; message?: string }
      return { 
        success: false, 
        originalSize,
        error: errorData.message || errorData.error || `HTTP ${uploadResponse.status}` 
      }
    }
    
    const result = await uploadResponse.json() as TinyPngResponse
    
    // Download compressed image
    const downloadResponse = await fetch(result.output.url)
    if (!downloadResponse.ok) {
      return { success: false, originalSize, error: 'Failed to download compressed image' }
    }
    
    const compressedBuffer = Buffer.from(await downloadResponse.arrayBuffer())
    
    return {
      success: true,
      data: compressedBuffer,
      originalSize,
      compressedSize: compressedBuffer.length
    }
  } catch (error) {
    return { 
      success: false, 
      originalSize: imageBuffer.length,
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

export function setupTinyPngHandlers(): void {
  // Check usage for all API keys
  ipcMain.handle('tinypng:checkAllUsage', async () => {
    const keys = getActiveApiKeys()
    const results: { id: number; apiKey: string; used: number; remaining: number }[] = []
    
    for (const key of keys) {
      const usage = await checkKeyUsage(key.api_key)
      if (usage) {
        results.push({
          id: key.id,
          apiKey: key.api_key.substring(0, 8) + '...',
          used: usage.used,
          remaining: usage.remaining
        })
        updateApiKeyUsage(key.id, usage.used)
      }
    }
    
    // Calculate totals
    const totalRemaining = results.reduce((sum, r) => sum + r.remaining, 0)
    const totalUsed = results.reduce((sum, r) => sum + r.used, 0)
    
    // Calculate reset time (first of next month)
    const now = new Date()
    const resetDate = new Date(now.getFullYear(), now.getMonth() + 1, 1)
    
    return {
      keys: results,
      totalRemaining,
      totalUsed,
      resetTime: resetDate.toISOString()
    }
  })
  
  // Compress a single image (used internally)
  ipcMain.handle('tinypng:compressBuffer', async (_event, imageData: ArrayBuffer) => {
    const keys = getActiveApiKeys()
    if (keys.length === 0) {
      return { success: false, error: 'No API keys available' }
    }
    
    // Find key with remaining quota
    for (const key of keys) {
      if (key.compression_count < 500) {
        const result = await compressImage(key.api_key, Buffer.from(imageData))
        if (result.success) {
          // Update compression count
          updateApiKeyUsage(key.id, key.compression_count + 1)
          return {
            success: true,
            data: result.data,
            originalSize: result.originalSize,
            compressedSize: result.compressedSize,
            savedBytes: result.originalSize - (result.compressedSize || 0)
          }
        }
        // If this key failed due to quota, try next
        if (result.error?.includes('quota')) {
          updateApiKeyUsage(key.id, 500) // Mark as exhausted
          continue
        }
        return result
      }
    }
    
    return { success: false, error: 'All API keys have reached their monthly limit' }
  })
}

export { checkKeyUsage, compressImage }
