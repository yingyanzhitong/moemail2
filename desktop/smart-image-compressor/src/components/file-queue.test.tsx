import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { FileQueue } from '@/components/file-queue'
import type { QueueItem } from '@/types'

const item: QueueItem = {
  id: 'image-1',
  name: '照片.png',
  sourcePath: '/图片/照片.png',
  outputPath: '/图片/压缩结果/照片.png',
  parentLabel: '/图片',
  originalSize: 2048,
  thumbnailDataUrl: null,
  status: 'compressing',
  stage: 'uploading',
}

it('服务容量不足时保留文件并展示可恢复的失败原因', () => {
  render(<FileQueue running={false} onRemove={vi.fn()} onClear={vi.fn()} items={[{
    id: 'one',
    name: '照片.png',
    sourcePath: '/图片/照片.png',
    outputPath: '/图片/压缩结果/照片.png',
    parentLabel: '/图片',
    originalSize: 2048,
    thumbnailDataUrl: null,
    status: 'failed',
    error: '服务容量暂时不足，请稍后重试',
  }]} />)
  expect(screen.getByText('照片.png')).toBeInTheDocument()
  expect(screen.getByText('服务容量暂时不足，请稍后重试')).toBeInTheDocument()
})

describe('压缩队列阶段状态', () => {
  it('在单张图片完成前展示当前 TinyPNG 处理阶段', () => {
    render(<FileQueue items={[item]} running onRemove={vi.fn()} onClear={vi.fn()} />)

    expect(screen.getByText('上传并等待 TinyPNG')).toBeInTheDocument()
    expect(screen.getByLabelText('compressing')).toBeInTheDocument()
  })
})
