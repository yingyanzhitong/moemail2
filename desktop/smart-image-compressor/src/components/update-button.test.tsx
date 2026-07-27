import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { UpdateButton } from '@/components/update-button'

const { checkMock, downloadAndInstallMock, relaunchMock } = vi.hoisted(() => ({
  checkMock: vi.fn(),
  downloadAndInstallMock: vi.fn(),
  relaunchMock: vi.fn(),
}))

vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true }))
vi.mock('@tauri-apps/plugin-process', () => ({ relaunch: relaunchMock }))
vi.mock('@tauri-apps/plugin-updater', () => ({ check: checkMock }))

describe('更新入口', () => {
  it('启动后检查更新，已是最新时不占用工具栏位置', async () => {
    checkMock.mockResolvedValue(null)

    render(<UpdateButton />)

    await waitFor(() => expect(checkMock).toHaveBeenCalledWith({ timeout: 30_000 }))
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('发现新版本后点击更新按钮会直接下载并安装', async () => {
    downloadAndInstallMock.mockImplementation(async (onEvent) => {
      onEvent({ event: 'Started', data: { contentLength: 100 } })
      onEvent({ event: 'Progress', data: { chunkLength: 100 } })
      onEvent({ event: 'Finished' })
    })
    checkMock.mockResolvedValue({ version: '0.2.5', downloadAndInstall: downloadAndInstallMock })

    render(<UpdateButton />)

    expect(await screen.findByRole('button', { name: '新版本 0.2.5' })).toHaveTextContent('更新')
    fireEvent.click(screen.getByRole('button', { name: '新版本 0.2.5' }))
    await waitFor(() => expect(downloadAndInstallMock).toHaveBeenCalledTimes(1))
    expect(relaunchMock).toHaveBeenCalledTimes(1)
    expect(screen.queryByText('应用更新')).not.toBeInTheDocument()
  })
})
