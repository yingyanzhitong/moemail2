import { useState, useCallback, DragEvent } from 'react'

interface FileInfo {
  path: string
  name: string
  size: number
  md5: string
  alreadyCompressed: boolean
}

interface CompressionResult {
  path: string
  status: 'success' | 'skipped' | 'error'
  originalSize?: number
  compressedSize?: number
  error?: string
}

function CompressionPage(): JSX.Element {
  const [selectedDir, setSelectedDir] = useState<string | null>(null)
  const [files, setFiles] = useState<FileInfo[]>([])
  const [results, setResults] = useState<CompressionResult[]>([])
  const [compressing, setCompressing] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [overwrite, setOverwrite] = useState(false)
  const [skipCompressed, setSkipCompressed] = useState(true)
  const [dragActive, setDragActive] = useState(false)
  const [droppedPaths, setDroppedPaths] = useState<string[]>([])

  const handleSelectDirectory = async () => {
    const dir = await window.api.dialog.openDirectory()
    if (dir) {
      setSelectedDir(dir)
      setFiles([])
      setResults([])
      await scanDirectory(dir)
    }
  }

  const scanDirectory = async (dir: string) => {
    setScanning(true)
    try {
      const result = await window.api.compression.scanDirectory(dir)
      if (result.success && result.files) {
        setFiles(result.files)
      }
    } catch (error) {
      console.error('Failed to scan directory:', error)
    } finally {
      setScanning(false)
    }
  }

  const handleCompress = async () => {
    if (!selectedDir) return
    
    setCompressing(true)
    setResults([])
    
    try {
      const result = await window.api.compression.compressDirectory(selectedDir, {
        overwrite,
        skipCompressed
      })
      
      if (result.success && result.results) {
        setResults(result.results)
        // Refresh file list
        await scanDirectory(selectedDir)
      }
    } catch (error) {
      console.error('Failed to compress:', error)
    } finally {
      setCompressing(false)
    }
  }

  const handleDrag = useCallback((e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (e.type === 'dragenter' || e.type === 'dragover') {
      setDragActive(true)
    } else if (e.type === 'dragleave') {
      setDragActive(false)
    }
  }, [])

  const handleDrop = useCallback(async (e: DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDragActive(false)
    
    const files = e.dataTransfer.files
    if (files.length > 0) {
      const paths: string[] = []
      for (let i = 0; i < files.length; i++) {
        // @ts-ignore - path is available in Electron
        if (files[i].path) {
          // @ts-ignore
          paths.push(files[i].path)
        }
      }
      setDroppedPaths(paths)
    }
  }, [])

  const handleCompressDropped = async () => {
    if (droppedPaths.length === 0) return
    
    setCompressing(true)
    setResults([])
    
    try {
      const result = await window.api.compression.compressDropped(droppedPaths, {
        overwrite
      })
      
      if (result.success && result.results) {
        setResults(result.results)
      }
    } catch (error) {
      console.error('Failed to compress dropped files:', error)
    } finally {
      setCompressing(false)
      setDroppedPaths([])
    }
  }

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
  }

  const successCount = results.filter(r => r.status === 'success').length
  const skippedCount = results.filter(r => r.status === 'skipped').length
  const errorCount = results.filter(r => r.status === 'error').length

  return (
    <div className="space-y-8">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Compress Images</h1>
        <p className="text-slate-400">Select a directory or drag and drop files to compress</p>
      </div>

      {/* Options */}
      <div className="glass-card p-6">
        <h3 className="text-lg font-semibold text-white mb-4">Options</h3>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={overwrite}
              onChange={(e) => setOverwrite(e.target.checked)}
              className="w-5 h-5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-slate-300">Overwrite original files</span>
          </label>
          
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={skipCompressed}
              onChange={(e) => setSkipCompressed(e.target.checked)}
              className="w-5 h-5 rounded border-white/20 bg-white/5 text-cyan-500 focus:ring-cyan-500"
            />
            <span className="text-slate-300">Skip already compressed files</span>
          </label>
        </div>
      </div>

      {/* Drag & Drop Zone */}
      <div
        className={`drop-zone ${dragActive ? 'active' : ''}`}
        onDragEnter={handleDrag}
        onDragLeave={handleDrag}
        onDragOver={handleDrag}
        onDrop={handleDrop}
      >
        <div className="text-center">
          <div className="w-16 h-16 mx-auto mb-4 rounded-2xl bg-white/5 flex items-center justify-center">
            <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
          </div>
          <p className="text-lg font-medium text-white mb-2">
            {droppedPaths.length > 0 
              ? `${droppedPaths.length} items ready to compress`
              : 'Drag and drop images or folders here'
            }
          </p>
          <p className="text-sm text-slate-500 mb-4">
            Supports PNG, JPG, JPEG, and WebP
          </p>
          {droppedPaths.length > 0 ? (
            <div className="flex gap-3 justify-center">
              <button 
                onClick={handleCompressDropped}
                disabled={compressing}
                className="btn-primary"
              >
                {compressing ? 'Compressing...' : 'Compress Files'}
              </button>
              <button 
                onClick={() => setDroppedPaths([])}
                className="btn-secondary"
              >
                Clear
              </button>
            </div>
          ) : (
            <button onClick={handleSelectDirectory} className="btn-secondary">
              Or select a folder
            </button>
          )}
        </div>
      </div>

      {/* Selected Directory */}
      {selectedDir && (
        <div className="glass-card p-6">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-lg font-semibold text-white">Selected Folder</h3>
              <p className="text-sm text-slate-400 font-mono">{selectedDir}</p>
            </div>
            <button
              onClick={() => {
                setSelectedDir(null)
                setFiles([])
                setResults([])
              }}
              className="text-slate-400 hover:text-white"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {scanning ? (
            <div className="flex items-center gap-3 text-slate-400">
              <div className="animate-spin w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full"></div>
              Scanning for images...
            </div>
          ) : (
            <>
              <div className="flex items-center gap-4 mb-4">
                <span className="text-slate-300">{files.length} images found</span>
                <span className="text-slate-500">|</span>
                <span className="text-green-400">
                  {files.filter(f => !f.alreadyCompressed).length} new
                </span>
                <span className="text-slate-500">|</span>
                <span className="text-slate-400">
                  {files.filter(f => f.alreadyCompressed).length} already compressed
                </span>
              </div>

              <button
                onClick={handleCompress}
                disabled={compressing || files.length === 0}
                className="btn-primary"
              >
                {compressing ? 'Compressing...' : 'Start Compression'}
              </button>
            </>
          )}
        </div>
      )}

      {/* Results */}
      {results.length > 0 && (
        <div className="glass-card p-6">
          <h3 className="text-lg font-semibold text-white mb-4">Results</h3>
          
          {/* Summary */}
          <div className="flex gap-6 mb-6 text-sm">
            <span className="text-green-400">✓ {successCount} compressed</span>
            <span className="text-slate-400">○ {skippedCount} skipped</span>
            <span className="text-red-400">✗ {errorCount} failed</span>
          </div>

          {/* Result list */}
          <div className="max-h-64 overflow-auto space-y-2">
            {results.map((result, index) => (
              <div 
                key={index}
                className={`flex items-center justify-between p-3 rounded-lg ${
                  result.status === 'success' 
                    ? 'bg-green-500/10' 
                    : result.status === 'skipped'
                    ? 'bg-slate-500/10'
                    : 'bg-red-500/10'
                }`}
              >
                <div className="flex items-center gap-3 min-w-0">
                  {result.status === 'success' ? (
                    <span className="text-green-400">✓</span>
                  ) : result.status === 'skipped' ? (
                    <span className="text-slate-400">○</span>
                  ) : (
                    <span className="text-red-400">✗</span>
                  )}
                  <span className="text-slate-300 truncate text-sm font-mono">
                    {result.path.split('/').pop()}
                  </span>
                </div>
                {result.status === 'success' && result.originalSize && result.compressedSize && (
                  <span className="text-sm text-slate-400">
                    {formatBytes(result.originalSize)} → {formatBytes(result.compressedSize)}
                    <span className="ml-2 text-green-400">
                      (-{Math.round((1 - result.compressedSize / result.originalSize) * 100)}%)
                    </span>
                  </span>
                )}
                {result.status === 'error' && (
                  <span className="text-sm text-red-400">{result.error}</span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

export default CompressionPage
