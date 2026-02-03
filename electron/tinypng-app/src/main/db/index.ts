import Database from 'better-sqlite3'
import { app } from 'electron'
import { join } from 'path'

let db: Database.Database | null = null

export async function initDatabase(): Promise<void> {
  const userDataPath = app.getPath('userData')
  const dbPath = join(userDataPath, 'tinypng-app.db')
  
  db = new Database(dbPath)
  
  // Create tables
  db.exec(`
    -- API Keys table
    CREATE TABLE IF NOT EXISTS api_keys (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      api_key TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      expires_at INTEGER NOT NULL,
      last_used_at INTEGER,
      compression_count INTEGER DEFAULT 0,
      is_active INTEGER DEFAULT 1
    );
    
    -- Authorization info
    CREATE TABLE IF NOT EXISTS authorization (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      first_authorized_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );
    
    -- Compressed files history (for MD5 deduplication)
    CREATE TABLE IF NOT EXISTS compressed_files (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      file_path TEXT NOT NULL,
      original_md5 TEXT NOT NULL,
      compressed_md5 TEXT,
      original_size INTEGER NOT NULL,
      compressed_size INTEGER,
      compressed_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
      api_key_id INTEGER,
      FOREIGN KEY (api_key_id) REFERENCES api_keys(id)
    );
    
    -- Create indexes
    CREATE INDEX IF NOT EXISTS idx_compressed_files_md5 ON compressed_files(original_md5);
    CREATE INDEX IF NOT EXISTS idx_api_keys_active ON api_keys(is_active);
  `)
  
  console.log('[DB] Database initialized at:', dbPath)
}

export function getDb(): Database.Database {
  if (!db) {
    throw new Error('Database not initialized')
  }
  return db
}

// API Key operations
export function addApiKey(apiKey: string, expiresAt: number): void {
  const db = getDb()
  db.prepare(`
    INSERT OR IGNORE INTO api_keys (api_key, expires_at) VALUES (?, ?)
  `).run(apiKey, expiresAt)
}

export function getActiveApiKeys(): { id: number; api_key: string; compression_count: number }[] {
  const db = getDb()
  return db.prepare(`
    SELECT id, api_key, compression_count 
    FROM api_keys 
    WHERE is_active = 1 AND expires_at > ?
  `).all(Date.now()) as { id: number; api_key: string; compression_count: number }[]
}

export function updateApiKeyUsage(id: number, compressionCount: number): void {
  const db = getDb()
  db.prepare(`
    UPDATE api_keys SET compression_count = ?, last_used_at = ? WHERE id = ?
  `).run(compressionCount, Date.now(), id)
}

// Authorization operations
export function setAuthorization(expiresAt: number): void {
  const db = getDb()
  const now = Date.now()
  db.prepare(`
    INSERT OR REPLACE INTO authorization (id, first_authorized_at, expires_at) 
    VALUES (1, COALESCE((SELECT first_authorized_at FROM authorization WHERE id = 1), ?), ?)
  `).run(now, expiresAt)
}

export function getAuthorization(): { first_authorized_at: number; expires_at: number } | null {
  const db = getDb()
  return db.prepare(`
    SELECT first_authorized_at, expires_at FROM authorization WHERE id = 1
  `).get() as { first_authorized_at: number; expires_at: number } | null
}

// Compressed files operations
export function isFileCompressed(md5: string): boolean {
  const db = getDb()
  const result = db.prepare(`
    SELECT 1 FROM compressed_files WHERE original_md5 = ? LIMIT 1
  `).get(md5)
  return !!result
}

export function addCompressedFile(
  filePath: string, 
  originalMd5: string, 
  compressedMd5: string | null,
  originalSize: number, 
  compressedSize: number | null,
  apiKeyId: number
): void {
  const db = getDb()
  db.prepare(`
    INSERT INTO compressed_files (file_path, original_md5, compressed_md5, original_size, compressed_size, api_key_id)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(filePath, originalMd5, compressedMd5, originalSize, compressedSize, apiKeyId)
}

export function getCompressionStats(): { 
  total_files: number; 
  total_original_size: number; 
  total_compressed_size: number 
} {
  const db = getDb()
  return db.prepare(`
    SELECT 
      COUNT(*) as total_files,
      COALESCE(SUM(original_size), 0) as total_original_size,
      COALESCE(SUM(compressed_size), 0) as total_compressed_size
    FROM compressed_files
  `).get() as { total_files: number; total_original_size: number; total_compressed_size: number }
}
