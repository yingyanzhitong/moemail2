import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { OverwriteConfirmDialog } from '@/components/overwrite-confirm-dialog'

describe('覆盖原文件确认', () => {
  it('开始覆盖前说明不可恢复和隐藏去重记录', () => {
    render(<OverwriteConfirmDialog open imageCount={98} onOpenChange={vi.fn()} onConfirm={vi.fn()} />)

    expect(screen.getByRole('heading', { name: '确认覆盖 98 张原图？' })).toBeInTheDocument()
    expect(screen.getByText(/无法从本软件恢复/)).toBeInTheDocument()
    expect(screen.getByText(/\.smartcompress\.json/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '确认覆盖并开始' })).toBeInTheDocument()
  })
})
