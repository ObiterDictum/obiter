import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { ApiEnv } from './env'
import { createTestApiEnv } from './test-api-env'

const resendSendMock = vi.hoisted(() => vi.fn())

const resendModuleKeys = Object.fromEntries(
  Object.keys(await import('resend')).map((key) => [key, undefined]),
)
mock.module('resend', () =>
  Object.assign(
    { ...resendModuleKeys },
    (() => ({
      Resend: vi.fn().mockImplementation(() => ({
        emails: { send: resendSendMock },
      })),
    }))(),
  ),
)

const {
  sendMagicLink,
  sendVerificationEmail,
  sendResetPasswordEmail,
  resetPasswordUrl,
  verificationEmailUrl,
  buildAuthAuditEvent,
  emailAndPasswordOptions,
  sendResetPasswordForUser,
  authPlugins,
  userAdditionalFields,
} = await import('./auth')

beforeEach(() => {
  resendSendMock.mockClear()
})

const baseEnv: ApiEnv = createTestApiEnv()

describe('authPlugins', () => {
  it('enables bearer authentication without changing cookie configuration', () => {
    const plugins = authPlugins(baseEnv)

    expect(plugins.map((plugin) => plugin.id)).toEqual(
      expect.arrayContaining(['bearer', 'magic-link']),
    )
    expect(plugins.find((plugin) => plugin.id === 'bearer')?.options).toEqual(
      undefined,
    )
  })
})

describe('userAdditionalFields — sign-up stash seam (config regression)', () => {
  it('accepts the sign-up organisation name but never privileged fields', () => {
    const fields = userAdditionalFields()

    expect(fields.pendingOrganisationName).toMatchObject({
      type: 'string',
      required: false,
    })
    expect(
      (fields.pendingOrganisationName as { input?: boolean }).input,
    ).not.toBe(false)
    expect(fields.organisationId).toMatchObject({ input: false })
    expect(fields.role).toMatchObject({ input: false })
  })
})

describe('sendMagicLink', () => {
  it('logs only numeric provider status codes', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    try {
      for (const statusCode of [429, 'secret']) {
        resendSendMock.mockResolvedValueOnce({
          data: null,
          error: { message: 'delivery failed', statusCode },
        })
        await expect(
          sendMagicLink(
            { ...baseEnv, resendApiKey: 're_test_key' },
            'user@example.test',
            'https://app.example.test/verify?token=abc',
          ),
        ).rejects.toThrow('delivery failed')
      }
      expect(consoleError.mock.calls[0]?.[1]).toMatchObject({ statusCode: 429 })
      expect(consoleError.mock.calls[1]?.[1]).toMatchObject({
        statusCode: undefined,
      })
    } finally {
      consoleError.mockRestore()
    }
  })

  it('logs the magic-link URL to the console and never calls Resend when no API key is configured', async () => {
    const consoleInfo = vi.spyOn(console, 'info').mockImplementation(() => {})

    await sendMagicLink(
      baseEnv,
      'user@example.test',
      'https://app.example.test/verify?token=abc',
    )

    expect(consoleInfo).toHaveBeenCalledWith(
      expect.stringContaining('[dev-only]'),
      expect.objectContaining({
        url: 'https://app.example.test/verify?token=abc',
      }),
    )
    expect(resendSendMock).not.toHaveBeenCalled()

    consoleInfo.mockRestore()
  })

  it('sends via Resend when an API key is configured', async () => {
    resendSendMock.mockResolvedValueOnce({
      data: { id: 'email_1' },
      error: null,
    })

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
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid domain' },
    })

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
      expect.objectContaining({
        url: 'https://app.example.test/verify-email?token=abc',
      }),
    )
    expect(resendSendMock).not.toHaveBeenCalled()

    consoleInfo.mockRestore()
  })

  it('sends via Resend when an API key is configured', async () => {
    resendSendMock.mockResolvedValueOnce({
      data: { id: 'email_2' },
      error: null,
    })

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
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid domain' },
    })

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
      expect.objectContaining({
        url: 'https://app.example.test/reset-password?token=abc',
      }),
    )
    expect(resendSendMock).not.toHaveBeenCalled()

    consoleInfo.mockRestore()
  })

  it('sends via Resend with both html and text parts when an API key is configured', async () => {
    resendSendMock.mockResolvedValueOnce({
      data: { id: 'email_3' },
      error: null,
    })

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
    expect(call.html).toContain(
      'https://app.example.test/reset-password?token=abc',
    )
    expect(typeof call.text).toBe('string')
    expect(call.text).toContain(
      'https://app.example.test/reset-password?token=abc',
    )
  })

  it('throws and logs when Resend reports a delivery error', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid domain' },
    })

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
    const url = resetPasswordUrl(
      { ...baseEnv, webOrigin: 'https://app.obiter.test' },
      'tok_123',
    )

    expect(url).toBe('https://app.obiter.test/reset-password?token=tok_123')
  })

  it('URL-encodes the token', () => {
    const url = resetPasswordUrl(
      { ...baseEnv, webOrigin: 'https://app.obiter.test' },
      'a b/c',
    )

    expect(url).toBe('https://app.obiter.test/reset-password?token=a%20b%2Fc')
  })

  it('uses the web origin even when the request came from the desktop custom scheme', () => {
    const url = resetPasswordUrl(
      {
        ...baseEnv,
        webOrigin: 'https://app.obiter.test',
        desktopOrigin: 'obiter://desktop-auth',
      },
      'tok_xyz',
    )

    expect(url).toContain('https://app.obiter.test/reset-password')
    expect(url).not.toContain('obiter://')
  })
})

describe('sendResetPasswordEmail — reset link targets the web origin', () => {
  it('sends an email whose URL contains the web origin and ?token=', async () => {
    resendSendMock.mockResolvedValueOnce({
      data: { id: 'email_4' },
      error: null,
    })

    await sendResetPasswordEmail(
      {
        ...baseEnv,
        resendApiKey: 're_test_key',
        webOrigin: 'https://app.obiter.test',
      },
      'user@example.test',
      resetPasswordUrl(
        { ...baseEnv, webOrigin: 'https://app.obiter.test' },
        'tok_abc',
      ),
    )

    const call = resendSendMock.mock.calls[0][0]
    expect(call.html).toContain(
      'https://app.obiter.test/reset-password?token=tok_abc',
    )
    expect(call.text).toContain(
      'https://app.obiter.test/reset-password?token=tok_abc',
    )
    expect(call.html).not.toContain('obiter://')
  })
})

describe('verificationEmailUrl', () => {
  it('returns the reader to the web app after the API verifies the token', () => {
    const url = verificationEmailUrl(
      {
        ...baseEnv,
        authBaseUrl: 'https://api.obiter.test',
        webOrigin: 'https://app.obiter.test',
      },
      'tok_123',
    )

    expect(url).toBe(
      'https://api.obiter.test/api/auth/verify-email?token=tok_123&callbackURL=https%3A%2F%2Fapp.obiter.test',
    )
  })

  it('keeps a split API origin for the token check and still lands on the web app', () => {
    const url = verificationEmailUrl(
      {
        ...baseEnv,
        authBaseUrl: 'http://localhost:8894',
        webOrigin: 'http://localhost:3094',
      },
      'a b/c',
    )

    const parsed = new URL(url)
    expect(parsed.origin).toBe('http://localhost:8894')
    expect(parsed.pathname).toBe('/api/auth/verify-email')
    expect(parsed.searchParams.get('token')).toBe('a b/c')
    expect(parsed.searchParams.get('callbackURL')).toBe(
      'http://localhost:3094',
    )
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
    const event = buildAuthAuditEvent({
      path: '/sign-in/email',
      newSession: null,
    })

    expect(event).toBeNull()
  })
})

describe('emailAndPasswordOptions — password reset revokes sessions (config regression)', () => {
  it('enables revokeSessionsOnPasswordReset so a stolen session is invalidated on reset', () => {
    expect(emailAndPasswordOptions(baseEnv).revokeSessionsOnPasswordReset).toBe(
      true,
    )
  })
})

describe('sendResetPasswordForUser — delivery failure is logged, not silent', () => {
  it('logs at error level and resolves when Resend rejects the reset email', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resendSendMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'invalid domain' },
    })

    await expect(
      sendResetPasswordForUser(
        {
          ...baseEnv,
          resendApiKey: 're_test_key',
          webOrigin: 'https://app.obiter.test',
        },
        'user@example.test',
        'tok_1',
      ),
    ).resolves.toBeUndefined()

    expect(consoleError).toHaveBeenCalledWith(
      'Reset-password email delivery failed',
      expect.objectContaining({
        email: expect.stringContaining('***@example.test'),
        domain: 'example.test',
      }),
    )
    expect(
      consoleError.mock.calls.some(
        ([, ctx]) =>
          typeof (ctx as { requestId?: unknown })?.requestId === 'string',
      ),
    ).toBe(true)

    consoleError.mockRestore()
  })

  it('does not log an error on a successful send', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {})
    resendSendMock.mockResolvedValueOnce({
      data: { id: 'email_ok' },
      error: null,
    })

    await sendResetPasswordForUser(
      {
        ...baseEnv,
        resendApiKey: 're_test_key',
        webOrigin: 'https://app.obiter.test',
      },
      'user@example.test',
      'tok_2',
    )

    expect(consoleError).not.toHaveBeenCalled()
    consoleError.mockRestore()
  })
})
