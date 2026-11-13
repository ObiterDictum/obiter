import { describe, expect, it } from 'bun:test'
import { parseTotpProvisioningUri } from './two-factor'

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
