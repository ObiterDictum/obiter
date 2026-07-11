import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ApiEnv } from './env'

const resendSendMock = vi.hoisted(() => vi.fn())

vi.mock('resend', () => ({
  Resend: vi.fn().mockImplementation(() => ({
    emails: { send: resendSendMock },
  })),
}))

const {
  sendMagicLink,
  sendVerificationEmail,
  sendResetPasswordEmail,
  resetPasswordUrl,
  buildAuthAuditEvent,
} = await import('./auth')

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

describe('sendResetPasswordEmail', () => {
  it('logs the reset URL to the console and never calls Resend when no API key is configured', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

    await sendResetPasswordEmail(
      baseEnv,
      'user@example.test',
      'https://app.example.test/reset-password?token=abc',
    )

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[dev-only]'),
      expect.objectContaining({ url: 'https://app.example.test/reset-password?token=abc' }),
    )
    expect(resendSendMock).not.toHaveBeenCalled()

    consoleInfo.mockRestore()
  })

  it('sends via Resend with both html and text parts when an API key is configured', async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: 'email_3' }, error: null })

    await sendResetPasswordEmail(
      { ...baseEnv, resendApiKey: 're_test_key' },
      'user@example.test',
      'https://app.example.test/reset-password?token=abc',
    )

    expect(resendSendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'onboarding@resend.dev',
        to: 'user@example.test',
        subject: 'Reset your Obiter password',
      }),
    )
    const call = resendSendMock.mock.calls[0][0]
    expect(typeof call.html).toBe('string')
    expect(call.html).toContain('https://app.example.test/reset-password?token=abc')
    expect(typeof call.text).toBe('string')
    expect(call.text).toContain('https://app.example.test/reset-password?token=abc')
  })

  it('throws and logs when Resend reports a delivery error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resendSendMock.mockResolvedValueOnce({ data: null, error: { message: 'invalid domain' } })

    await expect(
      sendResetPasswordEmail(
        { ...baseEnv, resendApiKey: 're_test_key' },
        'user@example.test',
        'https://app.example.test/reset-password?token=abc',
      ),
    ).rejects.toThrow('invalid domain')

    expect(consoleError).toHaveBeenCalledWith(
      expect.stringContaining('[resend]'),
      expect.objectContaining({ message: 'invalid domain' }),
    )

    consoleError.mockRestore()
  })
})

describe('resetPasswordUrl', () => {
  it('builds the reset link at the configured web origin with the token', () => {
    const url = resetPasswordUrl({ ...baseEnv, webOrigin: 'https://app.obiter.test' }, 'tok_123')

    expect(url).toBe('https://app.obiter.test/reset-password?token=tok_123')
  })

  it('URL-encodes the token', () => {
    const url = resetPasswordUrl({ ...baseEnv, webOrigin: 'https://app.obiter.test' }, 'a b/c')

    expect(url).toBe('https://app.obiter.test/reset-password?token=a%20b%2Fc')
  })

  it('uses the web origin even when the request came from the desktop custom scheme', () => {
    // The desktop renderer origin (env.desktopOrigin) must never appear in the
    // reset link — it would not open in a browser.
    const url = resetPasswordUrl(
      { ...baseEnv, webOrigin: 'https://app.obiter.test', desktopOrigin: 'obiter://desktop-auth' },
      'tok_xyz',
    )

    expect(url).toContain('https://app.obiter.test/reset-password')
    expect(url).not.toContain('obiter://')
  })
})

describe('sendResetPasswordEmail — reset link targets the web origin', () => {
  // Empirical guard: the email URL must contain the web origin, not
  // better-auth's default or the desktop scheme. This catches the case where
  // the sendResetPassword callback silently fails to derive the URL.
  it('sends an email whose URL contains the web origin and ?token=', async () => {
    resendSendMock.mockResolvedValueOnce({ data: { id: 'email_4' }, error: null })

    await sendResetPasswordEmail(
      { ...baseEnv, resendApiKey: 're_test_key', webOrigin: 'https://app.obiter.test' },
      'user@example.test',
      resetPasswordUrl({ ...baseEnv, webOrigin: 'https://app.obiter.test' }, 'tok_abc'),
    )

    const call = resendSendMock.mock.calls[0][0]
    expect(call.html).toContain('https://app.obiter.test/reset-password?token=tok_abc')
    expect(call.text).toContain('https://app.obiter.test/reset-password?token=tok_abc')
    // The desktop custom scheme must never leak into the reset link.
    expect(call.html).not.toContain('obiter://')
  })
})

describe('buildAuthAuditEvent', () => {
  it('audits an org-less sign-in with organisationId null', () => {
    const event = buildAuthAuditEvent({
      path: '/sign-in/email',
      newSession: {
        user: { id: 'usr_orgless', organisationId: null },
        session: { id: 'ses_1' },
      },
    })

    expect(event).toMatchObject({
      organisationId: null,
      userId: 'usr_orgless',
      action: 'auth.sign_in',
      entityType: 'session',
      entityId: 'ses_1',
    })
  })

  it('audits an org-present sign-in with the real organisation id', () => {
    const event = buildAuthAuditEvent({
      path: '/sign-in/email',
      newSession: {
        user: { id: 'usr_1', organisationId: 'org_1' },
        session: { id: 'ses_1' },
      },
    })

    expect(event?.organisationId).toBe('org_1')
    expect(event?.action).toBe('auth.sign_in')
    expect(event?.metadata.method).toBe('email_password')
  })

  it('audits sign-up and verify-email as auth.sign_up', () => {
    const signUp = buildAuthAuditEvent({
      path: '/sign-up/email',
      newSession: {
        user: { id: 'usr_new', organisationId: null },
        session: { id: 'ses_2' },
      },
    })
    const verifyEmail = buildAuthAuditEvent({
      path: '/verify-email',
      newSession: {
        user: { id: 'usr_new', organisationId: null },
        session: { id: 'ses_3' },
      },
    })

    expect(signUp?.action).toBe('auth.sign_up')
    expect(verifyEmail?.action).toBe('auth.sign_up')
    expect(verifyEmail?.metadata.emailVerified).toBe(true)
  })

  it('records the magic-link method on magic-link verify', () => {
    const event = buildAuthAuditEvent({
      path: '/magic-link/verify',
      newSession: {
        user: { id: 'usr_1', organisationId: 'org_1' },
        session: { id: 'ses_4' },
      },
    })

    expect(event?.action).toBe('auth.sign_in')
    expect(event?.metadata.method).toBe('magic_link')
  })

  it('returns null for non-audited paths', () => {
    const event = buildAuthAuditEvent({
      path: '/sign-out',
      newSession: {
        user: { id: 'usr_1', organisationId: 'org_1' },
        session: { id: 'ses_5' },
      },
    })

    expect(event).toBeNull()
  })

  it('returns null when no session was established', () => {
    const event = buildAuthAuditEvent({ path: '/sign-in/email', newSession: null })

    expect(event).toBeNull()
  })
})
