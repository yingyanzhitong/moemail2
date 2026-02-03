import { ipcMain } from 'electron'
import { readFileSync, writeFileSync, readdirSync, statSync, existsSync, mkdirSync } from 'fs'
import { join, basename, dirname, extname } from 'path'
import { createHash } from 'crypto'
import { isFileCompressed, addCompressedFile, getCompressionStats, getActiveApiKeys, updateApiKeyUsage } from '../db'
import { compressImage } from './tinypng-api'

// Calculate MD5 hash of a file
function calculateMd5(filePath: string): string {
  const fileBuffer = readFileSync(filePath)
  return createHash('md5').update(fileBuffer).digest('hex')
}

// Get all image files in a directory recursively
function getImageFiles(dir: string): string[] {
  const imageExtensions = ['.png', '.jpg', '.jpeg', '.webp']
  const files: string[] = []
  
  function walkDir(currentPath: string): void {
    const entries = readdirSync(currentPath, { withFileTypes: true })
    
    for (const entry of entries) {
      const fullPath = join(currentPath, entry.name)
      
      if (entry.isDirectory()) {
        walkDir(fullPath)
      } else if (entry.isFile()) {
        const ext = extname(entry.name).toLowerCase()
        if (imageExtensions.includes(ext)) {
          files.push(fullPath)
        }
      }
    }
  }
  
  walkDir(dir)
  return files
}

export function setupCompressionHandlers(): void {
  // Scan directory for images
  ipcMain.handle('compression:scanDirectory', (_event, dirPath: string) => {
    if (!existsSync(dirPath)) {
      return { success: false, error: 'Directory does not exist' }
    }
    
    const files = getImageFiles(dirPath)
    const results = files.map(filePath => {
      const stats = statSync(filePath)
      const md5 = calculateMd5(filePath)
      const alreadyCompressed = isFileCompressed(md5)
      
      return {
        path: filePath,
        name: basename(filePath),
        size: stats.size,
        md5,
        alreadyCompressed
      }
    })
    
    return {
      success: true,
      files: results,
      total: results.length,
      newFiles: results.filter(f => !f.alreadyCompressed).length,
      skippedFiles: results.filter(f => f.alreadyCompressed).length
    }
  })
  
  // Compress directory
  ipcMain.handle('compression:compressDirectory', async (_event, dirPath: string, options: { 
    overwrite: boolean;
    skipCompressed: boolean;
  }) => {
    const keys = getActiveApiKeys()
    if (keys.length === 0) {
      return { success: false, error: 'No API keys available' }
    }
    
    const files = getImageFiles(dirPath)
    const results: {
      path: string;
      status: 'success' | 'skipped' | 'error';
      originalSize?: number;
      compressedSize?: number;
      error?: string;
    }[] = []
    
    let currentKeyIndex = 0
    
    for (const filePath of files) {
      const md5 = calculateMd5(filePath)
      
      // Skip if already compressed
      if (options.skipCompressed && isFileCompressed(md5)) {
        results.push({ path: filePath, status: 'skipped' })
        continue
      }
      
      const imageBuffer = readFileSync(filePath)
      
      // Find a key with available quota
      let compressed = false
      while (currentKeyIndex < keys.length && !compressed) {
        const key = keys[currentKeyIndex]
        if (key.compression_count >= 500) {
          currentKeyIndex++
          continue
        }
        
        const result = await compressImage(key.api_key, imageBuffer)
        
        if (result.success && result.data) {
          // Determine output path
          let outputPath: string
          if (options.overwrite) {
            outputPath = filePath
          } else {
            const ext = extname(filePath)
            const nameWithoutExt = basename(filePath, ext)
            const dir = dirname(filePath)
            outputPath = join(dir, `${nameWithoutExt}_compressed${ext}`)
          }
          
          writeFileSync(outputPath, result.data)
          
          // Calculate compressed MD5
          const compressedMd5 = createHash('md5').update(result.data).digest('hex')
          
          // Record in database
          addCompressedFile(
            filePath,
            md5,
            compressedMd5,
            result.originalSize,
            result.compressedSize || 0,
            key.id
          )
          
          // Update key usage
          updateApiKeyUsage(key.id, key.compression_count + 1)
          keys[currentKeyIndex].compression_count++
          
          results.push({
            path: filePath,
            status: 'success',
            originalSize: result.originalSize,
            compressedSize: result.compressedSize
          })
          compressed = true
        } else if (result.error?.includes('quota')) {
          updateApiKeyUsage(key.id, 500)
          currentKeyIndex++
        } else {
          results.push({
            path: filePath,
            status: 'error',
            error: result.error
          })
          compressed = true // Move to next file
        }
      }
      
      if (!compressed) {
        results.push({
          path: filePath,
          status: 'error',
          error: 'All API keys have reached their monthly limit'
        })
      }
    }
    
    const successCount = results.filter(r => r.status === 'success').length
    const skippedCount = results.filter(r => r.status === 'skipped').length
    const errorCount = results.filter(r => r.status === 'error').length
    
    return {
      success: true,
      results,
      summary: {
        total: results.length,
        success: successCount,
        skipped: skippedCount,
        error: errorCount
      }
    }
  })
  
  // Compress dropped files/folders
  ipcMain.handle('compression:compressDropped', async (_event, paths: string[], options: {
    overwrite: boolean;
  }) => {
    const keys = getActiveApiKeys()
    if (keys.length === 0) {
      return { success: false, error: 'No API keys available' }
    }
    
    const allFiles: string[] = []
    
    for (const p of paths) {
      const stats = statSync(p)
      if (stats.isDirectory()) {
        allFiles.push(...getImageFiles(p))
      } else if (stats.isFile()) {
        const ext = extname(p).toLowerCase()
        if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
          allFiles.push(p)
        }
      }
    }
    
    // Similar logic to compressDirectory...
    const results: {
      path: string;
      status: 'success' | 'error';
      originalSize?: number;
      compressedSize?: number;
      error?: string;
    }[] = []
    
    let currentKeyIndex = 0
    
    for (const filePath of allFiles) {
      const imageBuffer = readFileSync(filePath)
      const md5 = calculateMd5(filePath)
      
      let compressed = false
      while (currentKeyIndex < keys.length && !compressed) {
        const key = keys[currentKeyIndex]
        if (key.compression_count >= 500) {
          currentKeyIndex++
          continue
        }
        
        const result = await compressImage(key.api_key, imageBuffer)
        
        if (result.success && result.data) {
          let outputPath: string
          if (options.overwrite) {
            outputPath = filePath
          } else {
            const ext = extname(filePath)
            const nameWithoutExt = basename(filePath, ext)
            const dir = dirname(filePath)
            outputPath = join(dir, `${nameWithoutExt}_compressed${ext}`)
          }
          
          writeFileSync(outputPath, result.data)
          
          const compressedMd5 = createHash('md5').update(result.data).digest('hex')
          addCompressedFile(
            filePath,
            md5,
            compressedMd5,
            result.originalSize,
            result.compressedSize || 0,
            key.id
          )
          
          updateApiKeyUsage(key.id, key.compression_count + 1)
          keys[currentKeyIndex].compression_count++
          
          results.push({
            path: filePath,
            status: 'success',
            originalSize: result.originalSize,
            compressedSize: result.compressedSize
          })
          compressed = true
        } else if (result.error?.includes('quota')) {
          updateApiKeyUsage(key.id, 500)
          currentKeyIndex++
        } else {
          results.push({
            path: filePath,
            status: 'error',
            error: result.error
          })
          compressed = true
        }
      }
      
      if (!compressed) {
        results.push({
          path: filePath,
          status: 'error',
          error: 'All API keys have reached their monthly limit'
        })
      }
    }
    
    return {
      success: true,
      results,
      summary: {
        total: results.length,
        success: results.filter(r => r.status === 'success').length,
        error: results.filter(r => r.status === 'error').length
      }
    }
  })
  
  // Get compression statistics
  ipcMain.handle('compression:getStats', () => {
    return getCompressionStats()
  })
}
