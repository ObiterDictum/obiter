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
    expect(env.meilisearchHost).toBe('http://localhost:7700')
    expect(env.meilisearchSearchApiKey).toBe('dev-key')
    expect(env.meilisearchAdminApiKey).toBe('dev-key')
    expect(env.legalAuthoritiesIndex).toBe('legal_authorities')
    expect(env.mojFindCaseLawBaseUrl).toBe('https://caselaw.nationalarchives.gov.uk')
    expect(env.mojFindCaseLawRateLimit).toBe(1000)
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
    delete process.env.MEILISEARCH_HOST
    delete process.env.MEILISEARCH_SEARCH_API_KEY
    delete process.env.MEILISEARCH_ADMIN_API_KEY
    delete process.env.LEGAL_AUTHORITIES_INDEX

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
    process.env.MEILISEARCH_HOST = 'https://search.ormont.example'
    process.env.MEILISEARCH_SEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'https://caselaw.nationalarchives.gov.uk'

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
    process.env.MEILISEARCH_HOST = 'https://search.ormont.example'
    process.env.MEILISEARCH_SEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'https://caselaw.nationalarchives.gov.uk'

    expect(() => readApiEnv()).toThrow('DATABASE_URL must be a valid URL.')

    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/ormont'
    process.env.PORT = '70000'

    expect(() => readApiEnv()).toThrow(
      'PORT must be an integer between 1 and 65535.',
    )

    process.env.PORT = '8787'
    process.env.MEILISEARCH_HOST = 'not a url'

    expect(() => readApiEnv()).toThrow('MEILISEARCH_HOST must be a valid URL.')

    process.env.MEILISEARCH_HOST = 'https://search.ormont.example'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal authorities'

    expect(() => readApiEnv()).toThrow(
      'LEGAL_AUTHORITIES_INDEX may only contain letters, numbers, underscores, and hyphens.',
    )

    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'not a url'

    expect(() => readApiEnv()).toThrow('MOJ_FIND_CASE_LAW_BASE_URL must be a valid URL.')

    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'https://caselaw.nationalarchives.gov.uk'
    process.env.MOJ_FIND_CASE_LAW_RATE_LIMIT = '0'

    expect(() => readApiEnv()).toThrow(
      'MOJ_FIND_CASE_LAW_RATE_LIMIT must be a positive integer.',
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
    process.env.MEILISEARCH_HOST = 'https://search.ormont.example/'
    process.env.MEILISEARCH_SEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'https://caselaw.nationalarchives.gov.uk/'
    process.env.MOJ_FIND_CASE_LAW_RATE_LIMIT = '250'
    process.env.PORT = '8788'

    const env = readApiEnv()

    expect(env.authBaseUrl).toBe('https://api.ormont.example')
    expect(env.webOrigin).toBe('https://app.ormont.example')
    expect(env.desktopOrigin).toBe('ormont://desktop-auth')
    expect(env.magicLinkWebhookUrl).toBe(
      'https://mail.ormont.example/magic-link',
    )
    expect(env.meilisearchHost).toBe('https://search.ormont.example')
    expect(env.meilisearchSearchApiKey).toBe('0123456789abcdef0123456789abcdef')
    expect(env.meilisearchAdminApiKey).toBe('0123456789abcdef0123456789abcdef')
    expect(env.legalAuthoritiesIndex).toBe('legal_authorities')
    expect(env.mojFindCaseLawBaseUrl).toBe('https://caselaw.nationalarchives.gov.uk')
    expect(env.mojFindCaseLawRateLimit).toBe(250)
    expect(env.port).toBe(8788)
  })

  it('does not allow the legacy Meilisearch API key', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'postgres://ormont:ormont@db.example.com:5432/ormont'
    process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.BETTER_AUTH_URL = 'https://api.ormont.example'
    process.env.ORMONT_WEB_ORIGIN = 'https://app.ormont.example'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_URL =
      'https://mail.ormont.example/magic-link'
    process.env.ORMONT_MAGIC_LINK_WEBHOOK_SECRET =
      '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_HOST = 'https://search.ormont.example'
    process.env.MEILISEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    delete process.env.MEILISEARCH_SEARCH_API_KEY
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'https://caselaw.nationalarchives.gov.uk'

    expect(() => readApiEnv()).toThrow(
      'Missing required production environment values: MEILISEARCH_SEARCH_API_KEY',
    )

    process.env.NODE_ENV = 'development'
    process.env.MEILISEARCH_API_KEY = 'legacy-dev-key'
    delete process.env.MEILISEARCH_SEARCH_API_KEY
    delete process.env.MEILISEARCH_ADMIN_API_KEY

    const env = readApiEnv()

    expect(env.meilisearchSearchApiKey).toBe('dev-key')
    expect(env.meilisearchAdminApiKey).toBe('dev-key')
  })
})
