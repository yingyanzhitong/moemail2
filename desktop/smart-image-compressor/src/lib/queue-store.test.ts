import { describe, expect, it } from 'vitest'
import { QueueStore } from '@/lib/queue-store'

describe('队列状态存储', () => {
  it('进度事件只替换命中的任务，不复制整张队列表', () => {
    const store = new QueueStore()
    store.add([
      { id: 'one', name: 'one.png', sourcePath: '/one.png', outputPath: '/out/one.png', parentLabel: '/', originalSize: 100, thumbnailDataUrl: null },
      { id: 'two', name: 'two.png', sourcePath: '/two.png', outputPath: '/out/two.png', parentLabel: '/', originalSize: 200, thumbnailDataUrl: null },
    ])
    const before = store.getSnapshot()
    const unchanged = before.items.get('two')

    store.applyProgress({ id: 'one', status: 'compressing', stage: 'uploading' })
    const after = store.getSnapshot()

    expect(after.items).toBe(before.items)
    expect(after.items.get('two')).toBe(unchanged)
    expect(after.items.get('one')).toMatchObject({ status: 'compressing', stage: 'uploading' })
  })

  it('按源路径去重，并在失败或取消后保留可重试任务', () => {
    const store = new QueueStore()
    store.add([
      { id: 'one', name: 'one.png', sourcePath: '/one.png', outputPath: '/out/one.png', parentLabel: '/', originalSize: 100, thumbnailDataUrl: null },
      { id: 'duplicate', name: 'again.png', sourcePath: '/one.png', outputPath: '/out/again.png', parentLabel: '/', originalSize: 100, thumbnailDataUrl: null },
    ])
    store.applyProgress({ id: 'one', status: 'cancelled', stage: null, error: '任务已取消' })

    expect(store.getSnapshot().order).toEqual(['one'])
    expect(store.actionableIds()).toEqual(['one'])
  })
})
