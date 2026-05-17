import { afterEach, describe, expect, it } from 'vitest'
import { readApiEnv } from './env'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('readApiEnv', () => {
  it('uses local development defaults without production secrets', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET

    const env = readApiEnv()

    expect(env.databaseUrl).toContain('localhost')
    expect(env.authSecret).toBe('dev-only-better-auth-secret')
    expect(env.nodeEnv).toBe('development')
  })

  it('uses TEST_DATABASE_URL as the only database URL in test mode', () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/prod'
    process.env.TEST_DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/ormont_test'

    const env = readApiEnv()

    expect(env.databaseUrl).toBe(
      'postgres://ormont:ormont@db.example.com:5432/ormont_test',
    )
    expect(env.nodeEnv).toBe('test')
  })

  it('fails loudly when test mode does not have a separate test database', () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/prod'
    delete process.env.TEST_DATABASE_URL

    expect(() => readApiEnv()).toThrow('Missing required test environment values')

    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL

    expect(() => readApiEnv()).toThrow('TEST_DATABASE_URL must not match DATABASE_URL.')
  })

  it('fails loudly when production auth and database values are missing', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_URL
    delete process.env.ORMONT_WEB_ORIGIN

    expect(() => readApiEnv()).toThrow('Missing required production environment values')
  })

  it('rejects weak production secrets', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/ormont'
    process.env.BETTER_AUTH_SECRET = 'short-secret'
    process.env.BETTER_AUTH_URL = 'https://api.ormont.example'
    process.env.ORMONT_WEB_ORIGIN = 'https://app.ormont.example'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_URL =
      'https://mail.ormont.example/magic-link'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_SECRET =
      '0123456789abcdef0123456789abcdef'

    expect(() => readApiEnv()).toThrow(
      'BETTER_AUTH_SECRET must be at least 32 characters in production.',
    )
  })

  it('rejects invalid URLs and ports', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'not a url'
    process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.BETTER_AUTH_URL = 'https://api.ormont.example'
    process.env.ORMONT_WEB_ORIGIN = 'https://app.ormont.example'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_URL =
      'https://mail.ormont.example/magic-link'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_SECRET =
      '0123456789abcdef0123456789abcdef'

    expect(() => readApiEnv()).toThrow('DATABASE_URL must be a valid URL.')

    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/ormont'
    process.env.PORT = '70000'

    expect(() => readApiEnv()).toThrow(
      'PORT must be an integer between 1 and 65535.',
    )
  })

  it('parses valid production configuration', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/ormont'
    process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.BETTER_AUTH_URL = 'https://api.ormont.example/'
    process.env.ORMONT_WEB_ORIGIN = 'https://app.ormont.example/'
    process.env.ORMONT_DESKTOP_ORIGIN = 'ormont://desktop-auth'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_URL =
      'https://mail.ormont.example/magic-link'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_SECRET =
      '0123456789abcdef0123456789abcdef'
    process.env.PORT = '8788'

    const env = readApiEnv()

    expect(env.authBaseUrl).toBe('https://api.ormont.example')
    expect(env.webOrigin).toBe('https://app.ormont.example')
    expect(env.desktopOrigin).toBe('ormont://desktop-auth')
    expect(env.magicLinkWebhookUrl).toBe(
      'https://mail.ormont.example/magic-link',
    )
    expect(env.port).toBe(8788)
  })
})
