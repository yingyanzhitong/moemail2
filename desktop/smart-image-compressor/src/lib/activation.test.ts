import { describe, expect, it } from 'vitest'
import { extractActivationCode } from '@/lib/activation'

describe('extractActivationCode', () => {
  it('从完整 HTTPS Auth Link 的路径中提取 Token', () => {
    expect(extractActivationCode('https://auth.example.com/activate/grant-token-1234567890')).toBe('grant-token-1234567890')
  })

  it('从完整 HTTPS Auth Link 的查询参数中提取 Token', () => {
    expect(extractActivationCode('https://auth.example.com/activate?token=grant-token-1234567890')).toBe('grant-token-1234567890')
  })

  it('保留手动粘贴的纯 Token', () => {
    expect(extractActivationCode('  grant-token-1234567890  ')).toBe('grant-token-1234567890')
  })
})
