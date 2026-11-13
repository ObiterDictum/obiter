import { describe, expect, it } from 'bun:test'
import { generateTotpCode, parseTotpProvisioningUri } from './two-factor'

describe('parseTotpProvisioningUri', () => {
  it('extracts the secret, issuer and account from an otpauth URI', () => {
    const parsed = parseTotpProvisioningUri(
      'otpauth://totp/Obiter%3Auser%40example.com?secret=ABCDEF&issuer=Obiter',
    )
    expect(parsed).toEqual({
      secret: 'ABCDEF',
      issuer: 'Obiter',
      account: 'Obiter:user@example.com',
    })
  })

  it('rejects a URI that is not an otpauth totp provisioning URI', () => {
    expect(parseTotpProvisioningUri('https://example.com')).toBeNull()
    expect(parseTotpProvisioningUri('otpauth://hotp/x?secret=ABC')).toBeNull()
    expect(parseTotpProvisioningUri('otpauth://totp/x')).toBeNull()
    expect(parseTotpProvisioningUri('not a url')).toBeNull()
  })
})

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
