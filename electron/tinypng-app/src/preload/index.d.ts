import { ElectronAPI } from '@electron-toolkit/preload'

interface AuthAPI {
  parseCode: (authLink: string) => Promise<{ 
    success: boolean; 
    error?: string;
    data?: { keyCount: number; expiresAt: string }
  }>
  redeem: (authLink: string, moEmailApiUrl: string) => Promise<{
    success: boolean;
    error?: string;
    data?: { keyCount: number; expiresAt: string }
  }>
  getKeys: () => Promise<{ id: number; api_key: string; compression_count: number }[]>
  getStatus: () => Promise<{
    isAuthorized: boolean;
    firstAuthorizedAt?: number;
    expiresAt?: number;
  }>
  clear: () => Promise<{ success: boolean }>
}

interface TinyPngAPI {
  checkAllUsage: () => Promise<{
    keys: { id: number; apiKey: string; used: number; remaining: number }[];
    totalRemaining: number;
    totalUsed: number;
    resetTime: string;
  }>
  compressBuffer: (imageData: ArrayBuffer) => Promise<{
    success: boolean;
    data?: Buffer;
    originalSize: number;
    compressedSize?: number;
    savedBytes?: number;
    error?: string;
  }>
}

interface CompressionAPI {
  scanDirectory: (dirPath: string) => Promise<{
    success: boolean;
    error?: string;
    files?: {
      path: string;
      name: string;
      size: number;
      md5: string;
      alreadyCompressed: boolean;
    }[];
    total?: number;
    newFiles?: number;
    skippedFiles?: number;
  }>
  compressDirectory: (dirPath: string, options: { overwrite: boolean; skipCompressed: boolean }) => Promise<{
    success: boolean;
    error?: string;
    results?: {
      path: string;
      status: 'success' | 'skipped' | 'error';
      originalSize?: number;
      compressedSize?: number;
      error?: string;
    }[];
    summary?: {
      total: number;
      success: number;
      skipped: number;
      error: number;
    };
  }>
  compressDropped: (paths: string[], options: { overwrite: boolean }) => Promise<{
    success: boolean;
    error?: string;
    results?: {
      path: string;
      status: 'success' | 'error';
      originalSize?: number;
      compressedSize?: number;
      error?: string;
    }[];
    summary?: {
      total: number;
      success: number;
      error: number;
    };
  }>
  getStats: () => Promise<{
    total_files: number;
    total_original_size: number;
    total_compressed_size: number;
  }>
}

interface DialogAPI {
  openDirectory: () => Promise<string | null>
  openFiles: () => Promise<string[]>
}

interface API {
  auth: AuthAPI
  tinypng: TinyPngAPI
  compression: CompressionAPI
  dialog: DialogAPI
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: API
  }
}
