import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEnv } from './env'

const resendSendMock = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: resendSendMock },
  })),
}))

const { sendMagicLink, sendVerificationEmail } = await import('./auth')

beforeEach(() => {
  resendSendMock.mockClear()
})

const baseEnv: ApiEnv = {
  databaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
  authSecret: 'dev-only-better-auth-secret',
  authBaseUrl: 'http://localhost:8787',
  webOrigin: 'http://localhost:3000',
  marketingOrigin: null,
  desktopOrigin: 'obiter://desktop-auth',
  resendApiKey: null,
  emailFrom: 'onboarding@resend.dev',
  meilisearchHost: 'http://localhost:7700',
  meilisearchSearchApiKey: 'dev-key',
  meilisearchAdminApiKey: 'dev-key',
  legalAuthoritiesIndex: 'legal_authorities',
  mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
  mojFindCaseLawRateLimit: 1000,
  port: 8787,
  nodeEnv: 'test',
}

describe('sendMagicLink', () => {
  it('logs the magic-link URL to the console and never calls Resend when no API key is configured', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

    await sendMagicLink(baseEnv, 'user@example.test', 'https://app.example.test/verify?token=abc')

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[dev-only]'),
      expect.objectContaining({ url: 'https://app.example.test/verify?token=abc' }),
    )
    expect(resendSendMock).not.toHaveBeenCalled()

    consoleInfo.mockRestore()
  })

  it('sends via Resend when an API key is configured', async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: 'email_1' }, error: null })

    await sendMagicLink(
      { ...baseEnv, resendApiKey: 're_test_key' },
      'user@example.test',
      'https://app.example.test/verify?token=abc',
    )

    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'onboarding@resend.dev',
        to: 'user@example.test',
      }),
    )
  })

  it('throws when Resend reports a delivery error', async () => {
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: 'invalid domain' } })

    await expect(
      sendMagicLink(
        { ...baseEnv, resendApiKey: 're_test_key' },
        'user@example.test',
        'https://app.example.test/verify?token=abc',
      ),
    ).rejects.toThrow('invalid domain')
  })
})

describe('sendVerificationEmail', () => {
  it('logs the verification URL to the console and never calls Resend when no API key is configured', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

    await sendVerificationEmail(
      baseEnv,
      'user@example.test',
      'https://app.example.test/verify-email?token=abc',
    )

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[dev-only]'),
      expect.objectContaining({ url: 'https://app.example.test/verify-email?token=abc' }),
    )
    expect(resendSendMock).not.toHaveBeenCalled()

    consoleInfo.mockRestore()
  })

  it('sends via Resend when an API key is configured', async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: 'email_2' }, error: null })

    await sendVerificationEmail(
      { ...baseEnv, resendApiKey: 're_test_key' },
      'user@example.test',
      'https://app.example.test/verify-email?token=abc',
    )

    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'onboarding@resend.dev',
        to: 'user@example.test',
        subject: 'Verify your Obiter email',
      }),
    )
  })

  it('throws and logs when Resend reports a delivery error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: 'invalid domain' } })

    await expect(
      sendVerificationEmail(
        { ...baseEnv, resendApiKey: 're_test_key' },
        'user@example.test',
        'https://app.example.test/verify-email?token=abc',
      ),
    ).rejects.toThrow('invalid domain')

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[resend]'),
      expect.objectContaining({ message: 'invalid domain' }),
    )

    consoleError.mockRestore()
  })
})
