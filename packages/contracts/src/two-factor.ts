import { z } from 'zod'

export const twoFactorSetupResponseSchema = z.object({
  method: z.literal('totp').optional(),
  totpURI: z.string().min(1),
  backupCodes: z.array(z.string().min(1)).min(1),
})
export type TwoFactorSetupResponse = z.infer<
  typeof twoFactorSetupResponseSchema
>

export const twoFactorBackupCodesResponseSchema = z.object({
  status: z.literal(true),
  backupCodes: z.array(z.string().min(1)).min(1),
})
export type TwoFactorBackupCodesResponse = z.infer<
  typeof twoFactorBackupCodesResponseSchema
>

export const twoFactorVerificationResponseSchema = z.object({
  token: z.string().optional(),
})
export type TwoFactorVerificationResponse = z.infer<
  typeof twoFactorVerificationResponseSchema
>

export const twoFactorStatusResponseSchema = z.object({
  status: z.literal(true),
})
export type TwoFactorStatusResponse = z.infer<
  typeof twoFactorStatusResponseSchema
>

export const totpProvisioningSchema = z.object({
  secret: z.string().min(1),
  issuer: z.string(),
  account: z.string(),
})
export type TotpProvisioning = z.infer<typeof totpProvisioningSchema>

export function parseTotpProvisioningUri(
  totpURI: string,
): TotpProvisioning | null {
  let url: URL
  try {
    url = new URL(totpURI)
  } catch {
    return null
  }
  if (url.protocol !== 'otpauth:' || url.hostname !== 'totp') return null
  const secret = url.searchParams.get('secret')
  if (!secret) return null
  return {
    secret,
    issuer: url.searchParams.get('issuer') ?? '',
    account: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
  }
}

const TOTP_PERIOD_SECONDS = 30
const TOTP_DIGITS = 6
const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

function base32Decode(value: string): Uint8Array<ArrayBuffer> {
  const clean = value.toUpperCase().replace(/=+$/u, '').replace(/\s+/gu, '')
  const bytes: number[] = []
  let buffer = 0
  let bitCount = 0
  for (const char of clean) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index === -1) throw new Error('The TOTP secret is not valid base32.')
    buffer = (buffer << 5) | index
    bitCount += 5
    if (bitCount >= 8) {
      bitCount -= 8
      bytes.push((buffer >> bitCount) & 0xff)
      buffer &= (1 << bitCount) - 1
    }
  }
  return new Uint8Array(bytes)
}

export async function generateTotpCode(
  secret: string,
  timestampMs: number = Date.now(),
): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    base32Decode(secret),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  )
  const counter = Math.floor(timestampMs / 1000 / TOTP_PERIOD_SECONDS)
  const message = new ArrayBuffer(8)
  const view = new DataView(message)
  view.setUint32(0, Math.floor(counter / 0x100000000))
  view.setUint32(4, counter % 0x100000000)
  const digest = new Uint8Array(await crypto.subtle.sign('HMAC', key, message))
  const offset = digest[digest.length - 1] & 0x0f
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    (digest[offset + 1] << 16) |
    (digest[offset + 2] << 8) |
    digest[offset + 3]
  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, '0')
}
