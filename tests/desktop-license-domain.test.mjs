import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateEmergencyKeyCount,
  getDesktopRedeemConflict,
  getNextDesktopPeriodWindow,
} from '../app/lib/desktop-license-domain.ts'
import {
  decryptDesktopGrantCode,
  encryptDesktopGrantCode,
} from '../app/lib/desktop-license-crypto.ts'

test('续费周期排在现有周期后，不覆盖当前周期', () => {
  assert.deepEqual(getNextDesktopPeriodWindow(100, 200, 30), { startsAt: 200, expiresAt: 230 })
  assert.deepEqual(getNextDesktopPeriodWindow(300, 200, 30), { startsAt: 300, expiresAt: 330 })
})

test('换机允许新设备，续费拒绝设备冲突', () => {
  const base = { grantStatus: 'issued', expiresAtMs: 200, nowMs: 100, licenseStatus: 'active', boundDeviceId: 'old', requestDeviceId: 'new' }
  assert.equal(getDesktopRedeemConflict({ ...base, kind: 'renew' }), 'DEVICE_CONFLICT')
  assert.equal(getDesktopRedeemConflict({ ...base, kind: 'rebind' }), null)
})

test('一次性凭证过期或已兑换后不可再次使用', () => {
  const base = { kind: 'new', expiresAtMs: 200, nowMs: 100, licenseStatus: 'pending', boundDeviceId: null, requestDeviceId: 'device' }
  assert.equal(getDesktopRedeemConflict({ ...base, grantStatus: 'redeemed' }), 'GRANT_EXPIRED')
  assert.equal(getDesktopRedeemConflict({ ...base, grantStatus: 'issued', nowMs: 200 }), 'GRANT_EXPIRED')
})

test('应急 Key 只补齐缺口且累计不超过 20 个', () => {
  assert.equal(calculateEmergencyKeyCount({ logicalRemaining: 4000, realRemaining: 3000, assignedCount: 40, emergencyCount: 0 }), 2)
  assert.equal(calculateEmergencyKeyCount({ logicalRemaining: 4000, realRemaining: 0, assignedCount: 58, emergencyCount: 18 }), 2)
  assert.equal(calculateEmergencyKeyCount({ logicalRemaining: 1000, realRemaining: 1000, assignedCount: 40, emergencyCount: 0 }), 0)
})

test('Auth Link code 加密后可恢复，错误密钥无法解密', async () => {
  const code = 'one-time-auth-code'
  const ciphertext = await encryptDesktopGrantCode(code, 'secret-a')

  assert.equal(ciphertext.includes(code), false)
  assert.equal(await decryptDesktopGrantCode(ciphertext, 'secret-a'), code)
  await assert.rejects(() => decryptDesktopGrantCode(ciphertext, 'secret-b'))
})
