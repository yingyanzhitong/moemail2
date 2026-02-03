import { useState, useEffect } from 'react'

interface KeyUsage {
  id: number
  apiKey: string
  used: number
  remaining: number
}

interface UsageData {
  keys: KeyUsage[]
  totalRemaining: number
  totalUsed: number
  resetTime: string
}

function DashboardPage(): JSX.Element {
  const [usageData, setUsageData] = useState<UsageData | null>(null)
  const [loading, setLoading] = useState(true)
  const [authStatus, setAuthStatus] = useState<{ expiresAt?: number } | null>(null)
  const [compressionStats, setCompressionStats] = useState<{
    total_files: number
    total_original_size: number
    total_compressed_size: number
  } | null>(null)

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    setLoading(true)
    try {
      const [usage, auth, stats] = await Promise.all([
        window.api.tinypng.checkAllUsage(),
        window.api.auth.getStatus(),
        window.api.compression.getStats()
      ])
      setUsageData(usage)
      setAuthStatus(auth)
      setCompressionStats(stats)
    } catch (error) {
      console.error('Failed to load data:', error)
    } finally {
      setLoading(false)
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const formatDate = (timestamp: number): string => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    })
  }

  const getTimeUntilReset = (): string => {
    if (!usageData?.resetTime) return ''
    const reset = new Date(usageData.resetTime)
    const now = new Date()
    const diff = reset.getTime() - now.getTime()
    const days = Math.floor(diff / (1000 * 60 * 60 * 24))
    return `${days} days`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="animate-pulse-glow w-16 h-16 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600"></div>
      </div>
    )
  }

  const savedPercentage = compressionStats && compressionStats.total_original_size > 0
    ? Math.round((1 - compressionStats.total_compressed_size / compressionStats.total_original_size) * 100)
    : 0

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white mb-2">Dashboard</h1>
          <p className="text-slate-400">Monitor your TinyPNG usage and compression stats</p>
        </div>
        <button onClick={loadData} className="btn-secondary flex items-center gap-2">
          <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          Refresh
        </button>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        <div className="stat-card">
          <div className="stat-value">{usageData?.totalRemaining || 0}</div>
          <div className="stat-label">Compressions Available</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-value">{usageData?.keys.length || 0}</div>
          <div className="stat-label">Active API Keys</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-value">{compressionStats?.total_files || 0}</div>
          <div className="stat-label">Files Compressed</div>
        </div>
        
        <div className="stat-card">
          <div className="stat-value">{savedPercentage}%</div>
          <div className="stat-label">Average Savings</div>
        </div>
      </div>

      {/* Reset & Expiration Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Monthly Reset
          </h3>
          <div className="text-3xl font-bold text-white mb-2">{getTimeUntilReset()}</div>
          <p className="text-slate-400 text-sm">
            until usage resets on {usageData?.resetTime ? new Date(usageData.resetTime).toLocaleDateString() : 'N/A'}
          </p>
        </div>

        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4 flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
            License Expiration
          </h3>
          <div className="text-3xl font-bold text-white mb-2">
            {authStatus?.expiresAt ? formatDate(authStatus.expiresAt) : 'N/A'}
          </div>
          <p className="text-slate-400 text-sm">
            Your API keys expire after 1 year
          </p>
        </div>
      </div>

      {/* API Keys Table */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">API Keys Usage</h3>
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-slate-400 text-sm border-b border-white/10">
                <th className="pb-3 font-medium">API Key</th>
                <th className="pb-3 font-medium">Used</th>
                <th className="pb-3 font-medium">Remaining</th>
                <th className="pb-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="text-slate-300">
              {usageData?.keys.map((key) => (
                <tr key={key.id} className="border-b border-white/5 hover:bg-white/5">
                  <td className="py-4 font-mono text-sm">{key.apiKey}</td>
                  <td className="py-4">{key.used}</td>
                  <td className="py-4">{key.remaining}</td>
                  <td className="py-4">
                    {key.remaining > 0 ? (
                      <span className="px-2 py-1 text-xs bg-green-500/20 text-green-400 rounded-full">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-1 text-xs bg-red-500/20 text-red-400 rounded-full">
                        Exhausted
                      </span>
                    )}
                  </td>
                </tr>
              ))}
              {(!usageData?.keys || usageData.keys.length === 0) && (
                <tr>
                  <td colSpan={4} className="py-8 text-center text-slate-500">
                    No API keys found
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Compression Stats */}
      {compressionStats && compressionStats.total_files > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Total Savings</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-2xl font-bold text-slate-300">
                {formatBytes(compressionStats.total_original_size)}
              </div>
              <div className="text-sm text-slate-500">Original Size</div>
            </div>
            <div>
              <div className="text-2xl font-bold text-slate-300">
                {formatBytes(compressionStats.total_compressed_size)}
              </div>
              <div className="text-sm text-slate-500">Compressed Size</div>
            </div>
            <div>
              <div className="text-2xl font-bold gradient-text">
                {formatBytes(compressionStats.total_original_size - compressionStats.total_compressed_size)}
              </div>
              <div className="text-sm text-slate-500">Total Saved</div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

export default DashboardPage
