import test from 'node:test'
import assert from 'node:assert/strict'
import { isPublicDesktopApiPath } from '../app/lib/desktop-license-routes.ts'

test('桌面激活预览和客户端授权接口不依赖网站登录会话', () => {
  assert.equal(isPublicDesktopApiPath('/api/tinypng/desktop/grants/preview'), true)
  assert.equal(isPublicDesktopApiPath('/api/tinypng/desktop/redeem'), true)
  assert.equal(isPublicDesktopApiPath('/api/tinypng/desktop/license'), true)
  assert.equal(isPublicDesktopApiPath('/api/tinypng/desktop/usage/reservations'), true)
  assert.equal(isPublicDesktopApiPath('/api/tinypng/desktop/keys/top-up'), true)
})

test('管理员创建 Auth Link 和管理接口仍需要网站登录会话', () => {
  assert.equal(isPublicDesktopApiPath('/api/tinypng/desktop/grants'), false)
  assert.equal(isPublicDesktopApiPath('/api/admin/tinypng-desktop/licenses'), false)
  assert.equal(isPublicDesktopApiPath('/api/admin/tinypng-desktop/licenses/license-id/auth-link'), false)
})
