import { useState } from 'react'

interface AuthorizationPageProps {
  onAuthorized: () => void
}

function AuthorizationPage({ onAuthorized }: AuthorizationPageProps): JSX.Element {
  const [authCode, setAuthCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parsedInfo, setParsedInfo] = useState<{ keyCount: number; expiresAt: string } | null>(null)

  const handleParseCode = async () => {
    if (!authCode.trim()) {
      setError('Please enter an authorization code')
      return
    }

    setLoading(true)
    setError(null)
    
    try {
      const result = await window.api.auth.parseCode(authCode)
      if (result.success && result.data) {
        setParsedInfo(result.data)
      } else {
        setError(result.error || 'Invalid authorization code')
      }
    } catch (err) {
      setError('Failed to parse authorization code')
    } finally {
      setLoading(false)
    }
  }

  const handleRedeem = async () => {
    if (!authCode.trim()) {
      setError('Please enter an authorization code')
      return
    }

    setLoading(true)
    setError(null)

    try {
      // Default to moemail API URL - user can customize this
      const moEmailApiUrl = 'https://moemail.app'
      const result = await window.api.auth.redeem(authCode, moEmailApiUrl)
      
      if (result.success) {
        onAuthorized()
      } else {
        setError(result.error || 'Failed to redeem authorization code')
      }
    } catch (err) {
      setError('Network error. Please check your connection.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-900 flex items-center justify-center p-8">
      {/* Background decoration */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-cyan-500/10 rounded-full blur-3xl"></div>
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-blue-500/10 rounded-full blur-3xl"></div>
      </div>
      
      <div className="relative z-10 glass-card p-10 max-w-md w-full">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-20 h-20 mx-auto mb-4 rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 flex items-center justify-center animate-pulse-glow">
            <svg className="w-10 h-10 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold gradient-text mb-2">TinyPNG App</h1>
          <p className="text-slate-400">Enter your authorization code to get started</p>
        </div>

        {/* Auth form */}
        <div className="space-y-6">
          <div>
            <label className="block text-sm font-medium text-slate-300 mb-2">
              Authorization Link
            </label>
            <textarea
              value={authCode}
              onChange={(e) => {
                setAuthCode(e.target.value)
                setParsedInfo(null)
                setError(null)
              }}
              placeholder="tinypng://eyJjb2RlIjoiYWJjMTIzIi..."
              className="input-field h-24 resize-none text-sm"
            />
          </div>

          {/* Parsed info */}
          {parsedInfo && (
            <div className="bg-green-500/10 border border-green-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-green-400 mb-2">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="font-medium">Valid Code</span>
              </div>
              <div className="text-sm text-slate-300 space-y-1">
                <p>API Keys: <span className="font-bold text-white">{parsedInfo.keyCount}</span></p>
                <p>Expires: <span className="text-slate-400">{new Date(parsedInfo.expiresAt).toLocaleDateString()}</span></p>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-red-400">
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span className="text-sm">{error}</span>
              </div>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3">
            {!parsedInfo ? (
              <button
                onClick={handleParseCode}
                disabled={loading || !authCode.trim()}
                className="btn-secondary flex-1"
              >
                {loading ? 'Checking...' : 'Validate Code'}
              </button>
            ) : (
              <button
                onClick={handleRedeem}
                disabled={loading}
                className="btn-primary flex-1"
              >
                {loading ? 'Activating...' : 'Activate Keys'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

export default AuthorizationPage
