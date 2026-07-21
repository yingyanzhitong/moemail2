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

  it('清空后导入新文件夹时只保留新文件夹的任务', () => {
    const store = new QueueStore()
    store.add([{ id: 'folder-one', name: 'one.png', sourcePath: '/folder-one/one.png', outputPath: '/folder-one-压缩结果/one.png', parentLabel: '/folder-one', originalSize: 100, thumbnailDataUrl: null }])

    store.clear()
    store.add([{ id: 'folder-two', name: 'two.png', sourcePath: '/folder-two/two.png', outputPath: '/folder-two-压缩结果/two.png', parentLabel: '/folder-two', originalSize: 200, thumbnailDataUrl: null }])

    expect(store.getSnapshot().order).toEqual(['folder-two'])
    expect([...store.getSnapshot().items.values()].map((item) => item.sourcePath)).toEqual(['/folder-two/two.png'])
  })
})
