import type { CompressionProgress, ImageJob, QueueItem, ThumbnailReady } from '@/types'

export interface QueueSnapshot {
  revision: number
  order: readonly string[]
  items: ReadonlyMap<string, QueueItem>
}

type Listener = () => void

/**
 * Tauri 会高频推送单项状态。这里保持稳定的 Map 与顺序数组，避免每个事件复制整个队列。
 */
export class QueueStore {
  private readonly items = new Map<string, QueueItem>()
  private readonly sourcePaths = new Set<string>()
  private readonly listeners = new Set<Listener>()
  private order: string[] = []
  private snapshot: QueueSnapshot = { revision: 0, order: this.order, items: this.items }

  subscribe = (listener: Listener) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = () => this.snapshot

  add(jobs: ImageJob[]) {
    let changed = false
    for (const job of jobs) {
      if (this.sourcePaths.has(job.sourcePath)) continue
      this.sourcePaths.add(job.sourcePath)
      this.order = [...this.order, job.id]
      this.items.set(job.id, { ...job, status: 'queued' })
      changed = true
    }
    if (changed) this.publish()
  }

  applyProgress(progress: CompressionProgress) {
    const current = this.items.get(progress.id)
    if (!current) return
    this.items.set(progress.id, { ...current, ...progress })
    this.publish()
  }

  applyThumbnail(thumbnail: ThumbnailReady) {
    const current = this.items.get(thumbnail.id)
    if (!current || current.thumbnailDataUrl === thumbnail.thumbnailDataUrl) return
    this.items.set(thumbnail.id, { ...current, thumbnailDataUrl: thumbnail.thumbnailDataUrl })
    this.publish()
  }

  resetPending(ids: readonly string[]) {
    let changed = false
    for (const id of ids) {
      const current = this.items.get(id)
      if (!current) continue
      this.items.set(id, { ...current, status: 'queued', stage: null, error: undefined })
      changed = true
    }
    if (changed) this.publish()
  }

  remove(ids: readonly string[]) {
    if (ids.length === 0) return
    const removed = new Set(ids)
    let changed = false
    for (const id of removed) {
      const item = this.items.get(id)
      if (!item) continue
      this.items.delete(id)
      this.sourcePaths.delete(item.sourcePath)
      changed = true
    }
    if (!changed) return
    this.order = this.order.filter((id) => !removed.has(id))
    this.publish()
  }

  clear() {
    if (this.order.length === 0) return
    this.items.clear()
    this.sourcePaths.clear()
    this.order = []
    this.publish()
  }

  actionableIds() {
    return this.order.filter((id) => {
      const status = this.items.get(id)?.status
      return status === 'queued' || status === 'failed' || status === 'cancelled'
    })
  }

  private publish() {
    this.snapshot = {
      revision: this.snapshot.revision + 1,
      order: this.order,
      items: this.items,
    }
    for (const listener of this.listeners) listener()
  }
}
