import { describe, expect, it } from 'bun:test'
import { generateTotpCode } from './totp'

describe('generateTotpCode', () => {
  it('matches the RFC 6238 SHA-1 vector at 59 seconds', async () => {
    const code = await generateTotpCode(
      'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ',
      59_000,
    )
    expect(code).toBe('287082')
  })

  it('returns a six-digit code for a lowercase secret with padding', async () => {
    const code = await generateTotpCode(
      'gezdgnbvgy3tqojqgezdgnbvgy3tqojq====',
      59_000,
    )
    expect(code).toMatch(/^\d{6}$/)
    expect(code).toBe('287082')
  })

  it('rejects a secret that is not base32', async () => {
    await expect(generateTotpCode('not-base32!!', 59_000)).rejects.toThrow()
  })
})
