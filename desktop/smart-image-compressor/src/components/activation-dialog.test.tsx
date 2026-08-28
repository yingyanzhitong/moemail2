import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ActivationDialog } from '@/components/activation-dialog'

function view(hasActivePackage: boolean) {
  render(
    <ActivationDialog
      open
      initialCode=""
      hasActivePackage={hasActivePackage}
      onOpenChange={vi.fn()}
      onRedeem={vi.fn()}
    />,
  )
}

describe('添加套餐弹窗', () => {
  it('有生效中套餐时显示添加套餐', () => {
    view(true)
    expect(screen.getByRole('button', { name: '添加套餐' })).toBeInTheDocument()
  })

  it('没有生效中套餐时显示添加并激活', () => {
    view(false)
    expect(screen.getByRole('button', { name: '添加并激活' })).toBeInTheDocument()
  })
})
