import { useState, useEffect } from 'react'
import { HashRouter, Routes, Route, Navigate } from 'react-router-dom'
import AuthorizationPage from './pages/AuthorizationPage'
import DashboardPage from './pages/DashboardPage'
import CompressionPage from './pages/CompressionPage'
import Layout from './components/Layout'

function App(): JSX.Element {
  const [isAuthorized, setIsAuthorized] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    checkAuthStatus()
  }, [])

  const checkAuthStatus = async () => {
    try {
      const status = await window.api.auth.getStatus()
      setIsAuthorized(status.isAuthorized)
    } catch (error) {
      console.error('Failed to check auth status:', error)
      setIsAuthorized(false)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="animate-pulse-glow w-16 h-16 rounded-full bg-gradient-to-r from-cyan-500 to-blue-600"></div>
      </div>
    )
  }

  return (
    <HashRouter>
      <Routes>
        {!isAuthorized ? (
          <>
            <Route 
              path="/auth" 
              element={<AuthorizationPage onAuthorized={() => setIsAuthorized(true)} />} 
            />
            <Route path="*" element={<Navigate to="/auth" replace />} />
          </>
        ) : (
          <Route element={<Layout />}>
            <Route path="/" element={<DashboardPage />} />
            <Route path="/compress" element={<CompressionPage />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
      </Routes>
    </HashRouter>
  )
}

export default App
