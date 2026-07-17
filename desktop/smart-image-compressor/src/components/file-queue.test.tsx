import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileQueue } from '@/components/file-queue'
import { QueueStore } from '@/lib/queue-store'
import type { CompressionProgress, ImageJob } from '@/types'

function snapshotFor(progress?: CompressionProgress) {
  const store = new QueueStore()
  const item: ImageJob = {
    id: 'image-1',
    name: '照片.png',
    sourcePath: '/图片/照片.png',
    outputPath: '/图片/压缩结果/照片.png',
    parentLabel: '/图片',
    originalSize: 2048,
    thumbnailDataUrl: null,
  }
  store.add([item])
  if (progress) store.applyProgress(progress)
  return store.getSnapshot()
}

function renderQueue(progress?: CompressionProgress) {
  return render(<FileQueue snapshot={snapshotFor(progress)} running={false} scanning={false} onRemove={vi.fn()} onClear={vi.fn()} onRequestThumbnails={vi.fn()} />)
}

it('服务容量不足时保留文件并展示可恢复的失败原因', () => {
  renderQueue({ id: 'image-1', status: 'failed', stage: null, error: '服务容量暂时不足，请稍后重试' })
  expect(screen.getByText('照片.png')).toBeInTheDocument()
  expect(screen.getByText('服务容量暂时不足，请稍后重试')).toBeInTheDocument()
})

describe('压缩队列阶段状态', () => {
  it('在单张图片完成前展示当前 TinyPNG 处理阶段', () => {
    renderQueue({ id: 'image-1', status: 'compressing', stage: 'uploading' })
    expect(screen.getByText('上传至 TinyPNG')).toBeInTheDocument()
    expect(screen.getByLabelText('compressing')).toBeInTheDocument()
  })
})
