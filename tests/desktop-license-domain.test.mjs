import test from 'node:test'
import assert from 'node:assert/strict'
import {
  calculateEmergencyKeyCount,
  getDesktopPeriodExpiry,
  getDesktopRedeemConflict,
  getNextDesktopPeriodWindow,
} from '../app/lib/desktop-license-domain.ts'
import {
  decryptDesktopGrantCode,
  encryptDesktopGrantCode,
} from '../app/lib/desktop-license-crypto.ts'

test('30 天套餐按自然月到期，续费周期仍排在现有周期后', () => {
  const july27 = Date.UTC(2026, 6, 27, 9, 47, 52, 634)
  const august27 = Date.UTC(2026, 7, 27, 9, 47, 52, 634)
  const july28 = Date.UTC(2026, 6, 27, 16, 40, 44, 45)
  const august28 = Date.UTC(2026, 7, 27, 16, 40, 44, 45)

  assert.equal(getDesktopPeriodExpiry(july27, 30), august27)
  assert.equal(getDesktopPeriodExpiry(july28, 30), august28)
  assert.deepEqual(getNextDesktopPeriodWindow(july27, august27, 30), {
    startsAt: august27,
    expiresAt: Date.UTC(2026, 8, 27, 9, 47, 52, 634),
  })
})

test('自然月到期在月末会落在目标月的最后一天，非 30 天按实际天数计算', () => {
  const january31 = Date.UTC(2026, 0, 31, 16, 40, 44, 45)
  assert.equal(getDesktopPeriodExpiry(january31, 30), Date.UTC(2026, 1, 28, 16, 40, 44, 45))
  assert.equal(getDesktopPeriodExpiry(january31, 45), january31 + 45 * 24 * 60 * 60 * 1000)
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
