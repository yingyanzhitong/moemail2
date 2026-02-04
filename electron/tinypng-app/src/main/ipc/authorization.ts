import { ipcMain } from 'electron'
import { addApiKey, getActiveApiKeys, getAuthorization, setAuthorization } from '../db'

// Authorization code format: tinypng://<base64-encoded-json>
// JSON format: { "code": "<random-token>", "count": <number-of-keys>, "expires": "<timestamp>" }

interface AuthCode {
  code: string
  count: number
  expires: string
}

export function parseAuthCode(authLink: string): { parsed: AuthCode | null; error?: string } {
  try {
    // Trim whitespace
    const trimmedLink = authLink.trim()
    
    if (!trimmedLink.startsWith('tinypng://')) {
      return { parsed: null, error: 'Link must start with tinypng://' }
    }
    
    const base64Data = trimmedLink.replace('tinypng://', '')
    
    if (!base64Data) {
      return { parsed: null, error: 'No data after tinypng://' }
    }
    
    let jsonStr: string
    try {
      jsonStr = Buffer.from(base64Data, 'base64').toString('utf-8')
    } catch {
      return { parsed: null, error: 'Invalid base64 encoding' }
    }
    
    let parsed: AuthCode
    try {
      parsed = JSON.parse(jsonStr) as AuthCode
    } catch {
      return { parsed: null, error: 'Invalid JSON in decoded data' }
    }
    
    // Validate fields
    if (!parsed.code || typeof parsed.count !== 'number' || !parsed.expires) {
      return { parsed: null, error: 'Missing required fields (code, count, or expires)' }
    }
    
    // Check if expired
    const expiresTime = new Date(parsed.expires).getTime()
    if (isNaN(expiresTime)) {
      return { parsed: null, error: 'Invalid expires date format' }
    }
    
    if (expiresTime < Date.now()) {
      return { parsed: null, error: 'Authorization code has expired' }
    }
    
    return { parsed }
  } catch (err) {
    return { parsed: null, error: `Unexpected error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

export function setupAuthHandlers(): void {
  // Parse and validate authorization code
  ipcMain.handle('auth:parseCode', (_event, authLink: string) => {
    const result = parseAuthCode(authLink)
    if (!result.parsed) {
      return { success: false, error: result.error || 'Invalid or expired authorization code' }
    }
    return { 
      success: true, 
      data: { 
        keyCount: result.parsed.count, 
        expiresAt: new Date(result.parsed.expires).toISOString() 
      }
    }
  })
  
  // Redeem authorization code and fetch API keys from moemail
  ipcMain.handle('auth:redeem', async (_event, authLink: string, moEmailApiUrl: string) => {
    const result = parseAuthCode(authLink)
    if (!result.parsed) {
      return { success: false, error: result.error || 'Invalid or expired authorization code' }
    }
    
    try {
      // Call moemail API to redeem the code and get API keys
      const response = await fetch(`${moEmailApiUrl}/api/tinypng/electron-auth/redeem`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          code: result.parsed.code,
          count: result.parsed.count
        })
      })
      
      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        return { 
          success: false, 
          error: (errorData as { error?: string }).error || `HTTP ${response.status}` 
        }
      }
      
      const data = await response.json() as { apiKeys: string[] }
      
      // Store API keys locally with 1 year expiration
      const oneYearFromNow = Date.now() + (365 * 24 * 60 * 60 * 1000)
      
      for (const apiKey of data.apiKeys) {
        addApiKey(apiKey, oneYearFromNow)
      }
      
      // Set authorization expiration
      setAuthorization(oneYearFromNow)
      
      return { 
        success: true, 
        data: { 
          keyCount: data.apiKeys.length,
          expiresAt: new Date(oneYearFromNow).toISOString()
        }
      }
    } catch (error) {
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Network error' 
      }
    }
  })
  
  // Get stored API keys
  ipcMain.handle('auth:getKeys', () => {
    const keys = getActiveApiKeys()
    return keys
  })
  
  // Get authorization status
  ipcMain.handle('auth:getStatus', () => {
    const auth = getAuthorization()
    if (!auth) {
      return { isAuthorized: false }
    }
    
    const isExpired = auth.expires_at < Date.now()
    return {
      isAuthorized: !isExpired,
      firstAuthorizedAt: auth.first_authorized_at,
      expiresAt: auth.expires_at
    }
  })
  
  // Clear authorization (for testing/reset)
  ipcMain.handle('auth:clear', () => {
    // This would clear all API keys and authorization
    // Implementation depends on whether you want to support this feature
    return { success: true }
  })
}
