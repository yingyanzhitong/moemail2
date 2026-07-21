import { fireEvent, render, screen } from '@testing-library/react'
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

function renderQueue(progress?: CompressionProgress, outputMode: 'new_folder' | 'overwrite' = 'new_folder', onOpenResults = vi.fn()) {
  return render(<FileQueue snapshot={snapshotFor(progress)} running={false} scanning={false} outputMode={outputMode} onRemove={vi.fn()} onClear={vi.fn()} onOpenResults={onOpenResults} onRequestThumbnails={vi.fn()} />)
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

  it('展示全部任务的总进度和已完成文件的总压缩率', () => {
    const onOpenResults = vi.fn()
    renderQueue({ id: 'image-1', status: 'completed', stage: null, compressedSize: 1024, savingsPercent: 50 }, 'new_folder', onOpenResults)
    expect(screen.getByText('全部 1 张')).toBeInTheDocument()
    expect(screen.getByText('1 / 1 张')).toBeInTheDocument()
    expect(screen.getByText('减少 50.0%')).toBeInTheDocument()
    expect(screen.getByText('节省 1.0 KB')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: '查看结果' }))
    expect(onOpenResults).toHaveBeenCalledWith(['image-1'])
  })

  it('覆盖原文件时不显示查看结果按钮', () => {
    renderQueue({ id: 'image-1', status: 'completed', stage: null, compressedSize: 1024, savingsPercent: 50 }, 'overwrite')
    expect(screen.queryByRole('button', { name: '查看结果' })).not.toBeInTheDocument()
  })

  it('将长队列限制在独立的可滚动列表区域', () => {
    renderQueue()
    expect(screen.getByRole('list', { name: '图片压缩队列' })).toHaveClass('queue-scroll', 'overflow-y-auto')
  })
})
