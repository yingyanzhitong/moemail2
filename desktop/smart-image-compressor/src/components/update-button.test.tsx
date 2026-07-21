import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateButton } from '@/components/update-button'

const { checkMock, versionMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  versionMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/api/app', () => ({ getVersion: versionMock }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: vi.fn() }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }))

describe('更新入口', () => {
  it('启动后检查更新，已是最新时不占用工具栏位置', async () => {
    versionMock.mockResolvedValue('0.2.5')
    checkMock.mockResolvedValue(null)

    render(<UpdateButton />)

    await waitFor(() => expect(checkMock).toHaveBeenCalledWith({ timeout: 30_000 }))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('发现新版本后显示更新操作', async () => {
    versionMock.mockResolvedValue('0.2.4')
    checkMock.mockResolvedValue({ version: '0.2.5', body: '修复 Gitee 发布同步。' })

    render(<UpdateButton />)

    expect(await screen.findByRole('button', { name: '新版本 0.2.5' })).toHaveTextContent('更新')
    fireEvent.click(screen.getByRole('button', { name: '新版本 0.2.5' }))
    expect(await screen.findByText('发现新版本 0.2.5')).toBeInTheDocument()
    expect(screen.getByText('有新版本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '立即更新' })).toBeInTheDocument()
  })
})
