import {
  twoFactorBackupCodesResponseSchema,
  twoFactorSetupResponseSchema,
  type TwoFactorBackupCodesResponse,
  type TwoFactorSetupResponse,
} from '@obiter/contracts/two-factor'
import { authClient } from './auth'

export interface TwoFactorActionResult<T> {
  ok: boolean
  data?: T
  message?: string
  code?: string
}

function actionError(error: { message?: unknown; code?: unknown }) {
  const code = typeof error.code === 'string' ? error.code : undefined
  const fallback = typeof error.message === 'string' ? error.message : undefined
  return { message: twoFactorActionMessage(code, fallback), code }
}

function twoFactorActionMessage(
  code: string | undefined,
  fallback?: string,
): string {
  switch (code) {
    case 'INVALID_PASSWORD':
      return 'Your password is incorrect.'
    case 'INVALID_CODE':
      return 'That code is not correct. Check it and try again.'
    case 'TOTP_ALREADY_ENABLED':
      return 'Two-factor authentication is already set up.'
    case 'TOTP_NOT_ENABLED':
      return 'Two-factor authentication is not set up.'
    case 'TWO_FACTOR_NOT_ENABLED':
      return 'Two-factor authentication is not set up.'
    case 'TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE':
      return 'Too many incorrect attempts. Try again later.'
    case 'ACCOUNT_TEMPORARILY_LOCKED':
      return 'Too many incorrect attempts. Try again later.'
    default:
      return fallback ?? 'Could not complete the request. Try again.'
  }
}

function parseSetup(data: unknown): TwoFactorSetupResponse | null {
  const parsed = twoFactorSetupResponseSchema.safeParse(data)
  return parsed.success ? parsed.data : null
}

function parseBackupCodes(data: unknown): string[] | null {
  const parsed = twoFactorBackupCodesResponseSchema.safeParse(data)
  return parsed.success ? parsed.data.backupCodes : null
}

export async function enableTwoFactor(
  password: string,
): Promise<TwoFactorActionResult<TwoFactorSetupResponse>> {
  const result = await authClient.twoFactor.enable({ password })
  if (result.error) {
    return { ok: false, ...actionError(result.error) }
  }
  const data = parseSetup(result.data)
  if (!data) {
    return {
      ok: false,
      message: 'Could not start two-factor setup. Try again.',
    }
  }
  return { ok: true, data }
}

export async function confirmTwoFactorEnrolment(
  code: string,
): Promise<TwoFactorActionResult<null>> {
  const result = await authClient.twoFactor.verifyTotp({ code })
  if (result.error) {
    return { ok: false, ...actionError(result.error) }
  }
  return { ok: true, data: null }
}

export async function disableTwoFactor(
  password: string,
): Promise<TwoFactorActionResult<null>> {
  const result = await authClient.twoFactor.disable({ password })
  if (result.error) {
    return { ok: false, ...actionError(result.error) }
  }
  return { ok: true, data: null }
}

export async function regenerateTwoFactorBackupCodes(
  password: string,
): Promise<TwoFactorActionResult<TwoFactorBackupCodesResponse>> {
  const result = await authClient.twoFactor.generateBackupCodes({ password })
  if (result.error) {
    return { ok: false, ...actionError(result.error) }
  }
  const backupCodes = parseBackupCodes(result.data)
  if (!backupCodes) {
    return {
      ok: false,
      message: 'Could not regenerate backup codes. Try again.',
    }
  }
  return { ok: true, data: { status: true, backupCodes } }
}

export async function twoFactorQrDataUrl(totpURI: string): Promise<string> {
  const { toDataURL } = await import('qrcode')
  return toDataURL(totpURI, { margin: 1, width: 192 })
}
