import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// Custom APIs for renderer
const api = {
  // Authorization
  auth: {
    parseCode: (authLink: string) => ipcRenderer.invoke('auth:parseCode', authLink),
    redeem: (authLink: string, moEmailApiUrl: string) => 
      ipcRenderer.invoke('auth:redeem', authLink, moEmailApiUrl),
    getKeys: () => ipcRenderer.invoke('auth:getKeys'),
    getStatus: () => ipcRenderer.invoke('auth:getStatus'),
    clear: () => ipcRenderer.invoke('auth:clear')
  },
  
  // TinyPNG API
  tinypng: {
    checkAllUsage: () => ipcRenderer.invoke('tinypng:checkAllUsage'),
    compressBuffer: (imageData: ArrayBuffer) => 
      ipcRenderer.invoke('tinypng:compressBuffer', imageData)
  },
  
  // Compression
  compression: {
    scanDirectory: (dirPath: string) => 
      ipcRenderer.invoke('compression:scanDirectory', dirPath),
    compressDirectory: (dirPath: string, options: { overwrite: boolean; skipCompressed: boolean }) =>
      ipcRenderer.invoke('compression:compressDirectory', dirPath, options),
    compressDropped: (paths: string[], options: { overwrite: boolean }) =>
      ipcRenderer.invoke('compression:compressDropped', paths, options),
    getStats: () => ipcRenderer.invoke('compression:getStats')
  },
  
  // Dialogs
  dialog: {
    openDirectory: () => ipcRenderer.invoke('dialog:openDirectory'),
    openFiles: () => ipcRenderer.invoke('dialog:openFiles')
  }
}

// Use `contextBridge` APIs to expose Electron APIs to
// renderer only if context isolation is enabled, otherwise
// just add to the DOM global.
if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', api)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore (define in dts)
  window.electron = electronAPI
  // @ts-ignore (define in dts)
  window.api = api
}
