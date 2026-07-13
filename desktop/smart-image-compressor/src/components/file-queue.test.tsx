import { render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { FileQueue } from '@/components/file-queue'

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
