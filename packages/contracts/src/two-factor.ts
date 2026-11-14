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
