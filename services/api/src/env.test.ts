import { afterEach, describe, expect, it } from 'vitest'
import { readApiEnv, readRampartDetectionConfig } from './env'
import { defaultRampartCacheDir } from './rampart-cache'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('readApiEnv', () => {
  it('uses local development defaults without production secrets', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_URL
    delete process.env.OBITER_WEB_ORIGIN
    delete process.env.OBITER_RAMPART_MODEL
    delete process.env.OBITER_RAMPART_REVISION
    delete process.env.OBITER_RAMPART_CACHE_DIR
    delete process.env.OBITER_RAMPART_MIN_SCORE
    delete process.env.OBITER_RAMPART_CHUNK_TOKENS

    const env = readApiEnv()

    expect(env.databaseUrl).toContain('localhost')
    expect(env.authSecret).toBe('dev-only-better-auth-secret')
    expect(env.authBaseUrl).toBe('http://localhost:3000')
    expect(env.meilisearchHost).toBe('http://localhost:7700')
    expect(env.meilisearchSearchApiKey).toBe('dev-key')
    expect(env.meilisearchAdminApiKey).toBe('dev-key')
    expect(env.legalAuthoritiesIndex).toBe('legal_authorities')
    expect(env.mojFindCaseLawBaseUrl).toBe(
      'https://caselaw.nationalarchives.gov.uk',
    )
    expect(env.mojFindCaseLawRateLimit).toBe(1000)
    expect(env.rampartModel).toBe('qarlus/rampart')
    expect(env.rampartRevision).toBe('c3221c5cd838eb69a249ab40f8b442483865f233')
    expect(env.rampartCacheDir).toBe(defaultRampartCacheDir())
    expect(env.rampartMinScore).toBe(0.4)
    expect(env.rampartChunkTokens).toBe(400)
    expect(env.nodeEnv).toBe('development')
  })

  it('treats an empty DATABASE_URL as absent in development', () => {
    process.env.NODE_ENV = 'development'
    process.env.DATABASE_URL = ''
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_URL
    delete process.env.OBITER_WEB_ORIGIN
    delete process.env.OBITER_RAMPART_MODEL
    delete process.env.OBITER_RAMPART_REVISION
    delete process.env.OBITER_RAMPART_CACHE_DIR
    delete process.env.OBITER_RAMPART_MIN_SCORE
    delete process.env.OBITER_RAMPART_CHUNK_TOKENS

    const env = readApiEnv()

    expect(env.databaseUrl).toContain('localhost')
  })

  it('reads validated Rampart configuration once with the rest of the API environment', () => {
    process.env.NODE_ENV = 'development'
    process.env.OBITER_RAMPART_MODEL = 'example/rampart-test'
    process.env.OBITER_RAMPART_REVISION = 'revision-1'
    process.env.OBITER_RAMPART_CACHE_DIR = '/tmp/rampart-cache'
    process.env.OBITER_RAMPART_MIN_SCORE = '0.65'
    process.env.OBITER_RAMPART_CHUNK_TOKENS = '320'

    const env = readApiEnv()

    expect(env).toMatchObject({
      rampartModel: 'example/rampart-test',
      rampartRevision: 'revision-1',
      rampartCacheDir: '/tmp/rampart-cache',
      rampartMinScore: 0.65,
      rampartChunkTokens: 320,
    })

    process.env.OBITER_RAMPART_CACHE_DIR = ''
    expect(readApiEnv().rampartCacheDir).toBe(defaultRampartCacheDir())
  })

  it('defaults the model cache outside the workspace so installs do not discard it', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.OBITER_RAMPART_CACHE_DIR

    const cacheDir = readApiEnv().rampartCacheDir

    expect(cacheDir).not.toContain('node_modules')
    expect(cacheDir).toBe(defaultRampartCacheDir())
  })

  it.each([
    ['OBITER_RAMPART_MODEL', '', 'must not be blank'],
    ['OBITER_RAMPART_REVISION', ' revision ', 'must not be blank'],
    ['OBITER_RAMPART_CACHE_DIR', ' ', 'must not be blank'],
    [
      'OBITER_RAMPART_MIN_SCORE',
      'not-a-number',
      'must be a number between 0 and 1',
    ],
    ['OBITER_RAMPART_MIN_SCORE', '1.1', 'must be a number between 0 and 1'],
    [
      'OBITER_RAMPART_CHUNK_TOKENS',
      '64',
      'must be an integer between 65 and 500',
    ],
    [
      'OBITER_RAMPART_CHUNK_TOKENS',
      '501',
      'must be an integer between 65 and 500',
    ],
    [
      'OBITER_RAMPART_CHUNK_TOKENS',
      '399.5',
      'must be an integer between 65 and 500',
    ],
  ])('rejects invalid %s configuration', (key, value, reason) => {
    process.env.NODE_ENV = 'development'
    process.env[key] = value

    expect(() => readApiEnv()).toThrow(`${key} ${reason}`)
  })

  it('uses TEST_DATABASE_URL as the only database URL in test mode', () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/prod'
    process.env.TEST_DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/obiter_test'

    const env = readApiEnv()

    expect(env.databaseUrl).toBe(
      'postgres://obiter:obiter@db.example.com:5432/obiter_test',
    )
    expect(env.nodeEnv).toBe('test')
  })

  it('fails loudly when test mode does not have a separate test database', () => {
    process.env.NODE_ENV = 'test'
    process.env.DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/prod'
    delete process.env.TEST_DATABASE_URL

    expect(() => readApiEnv()).toThrow(
      'Missing required test environment values',
    )

    process.env.TEST_DATABASE_URL = process.env.DATABASE_URL

    expect(() => readApiEnv()).toThrow(
      'TEST_DATABASE_URL must not match DATABASE_URL.',
    )
  })

  it('fails loudly when production auth and database values are missing', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.BETTER_AUTH_URL
    delete process.env.OBITER_WEB_ORIGIN
    delete process.env.MEILISEARCH_HOST
    delete process.env.MEILISEARCH_SEARCH_API_KEY
    delete process.env.MEILISEARCH_ADMIN_API_KEY
    delete process.env.LEGAL_AUTHORITIES_INDEX

    expect(() => readApiEnv()).toThrow(
      'Missing required production environment values',
    )
  })

  it('rejects weak production secrets', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/obiter'
    process.env.BETTER_AUTH_SECRET = 'short-secret'
    process.env.BETTER_AUTH_URL = 'https://api.obiter.example'
    process.env.OBITER_WEB_ORIGIN = 'https://app.obiter.example'
    process.env.OBITER_RESEND_API_KEY = 're_0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_HOST = 'https://search.obiter.example'
    process.env.MEILISEARCH_SEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL =
      'https://caselaw.nationalarchives.gov.uk'

    expect(() => readApiEnv()).toThrow(
      'BETTER_AUTH_SECRET must be at least 32 characters in production.',
    )
  })

  it('rejects invalid URLs and ports', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL = 'not a url'
    process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.BETTER_AUTH_URL = 'https://api.obiter.example'
    process.env.OBITER_WEB_ORIGIN = 'https://app.obiter.example'
    process.env.OBITER_RESEND_API_KEY = 're_0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_HOST = 'https://search.obiter.example'
    process.env.MEILISEARCH_SEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL =
      'https://caselaw.nationalarchives.gov.uk'

    expect(() => readApiEnv()).toThrow('DATABASE_URL must be a valid URL.')

    process.env.DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/obiter'
    process.env.PORT = '70000'

    expect(() => readApiEnv()).toThrow(
      'PORT must be an integer between 1 and 65535.',
    )

    process.env.PORT = '8787'
    process.env.MEILISEARCH_HOST = 'not a url'

    expect(() => readApiEnv()).toThrow('MEILISEARCH_HOST must be a valid URL.')

    process.env.MEILISEARCH_HOST = 'https://search.obiter.example'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal authorities'

    expect(() => readApiEnv()).toThrow(
      'LEGAL_AUTHORITIES_INDEX may only contain letters, numbers, underscores, and hyphens.',
    )

    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL = 'not a url'

    expect(() => readApiEnv()).toThrow(
      'MOJ_FIND_CASE_LAW_BASE_URL must be a valid URL.',
    )

    process.env.MOJ_FIND_CASE_LAW_BASE_URL =
      'https://caselaw.nationalarchives.gov.uk'
    process.env.MOJ_FIND_CASE_LAW_RATE_LIMIT = '0'

    expect(() => readApiEnv()).toThrow(
      'MOJ_FIND_CASE_LAW_RATE_LIMIT must be a positive integer.',
    )
  })

  it('parses valid production configuration', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/obiter'
    process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.BETTER_AUTH_URL = 'https://api.obiter.example/'
    process.env.OBITER_WEB_ORIGIN = 'https://app.obiter.example/'
    process.env.OBITER_DESKTOP_ORIGIN = 'obiter://desktop-auth'
    process.env.OBITER_RESEND_API_KEY = 're_0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_HOST = 'https://search.obiter.example/'
    process.env.MEILISEARCH_SEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL =
      'https://caselaw.nationalarchives.gov.uk/'
    process.env.MOJ_FIND_CASE_LAW_RATE_LIMIT = '250'
    process.env.PORT = '8788'

    const env = readApiEnv()

    expect(env.authBaseUrl).toBe('https://api.obiter.example')
    expect(env.webOrigin).toBe('https://app.obiter.example')
    expect(env.desktopOrigin).toBe('obiter://desktop-auth')
    expect(env.resendApiKey).toBe('re_0123456789abcdef0123456789abcdef')
    expect(env.meilisearchHost).toBe('https://search.obiter.example')
    expect(env.meilisearchSearchApiKey).toBe('0123456789abcdef0123456789abcdef')
    expect(env.meilisearchAdminApiKey).toBe('0123456789abcdef0123456789abcdef')
    expect(env.legalAuthoritiesIndex).toBe('legal_authorities')
    expect(env.mojFindCaseLawBaseUrl).toBe(
      'https://caselaw.nationalarchives.gov.uk',
    )
    expect(env.mojFindCaseLawRateLimit).toBe(250)
    expect(env.port).toBe(8788)
  })

  it('does not allow the legacy Meilisearch API key', () => {
    process.env.NODE_ENV = 'production'
    process.env.DATABASE_URL =
      'postgres://obiter:obiter@db.example.com:5432/obiter'
    process.env.BETTER_AUTH_SECRET = '0123456789abcdef0123456789abcdef'
    process.env.BETTER_AUTH_URL = 'https://api.obiter.example'
    process.env.OBITER_WEB_ORIGIN = 'https://app.obiter.example'
    process.env.OBITER_RESEND_API_KEY = 're_0123456789abcdef0123456789abcdef'
    process.env.MEILISEARCH_HOST = 'https://search.obiter.example'
    process.env.MEILISEARCH_API_KEY = '0123456789abcdef0123456789abcdef'
    delete process.env.MEILISEARCH_SEARCH_API_KEY
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef0123456789abcdef'
    process.env.LEGAL_AUTHORITIES_INDEX = 'legal_authorities'
    process.env.MOJ_FIND_CASE_LAW_BASE_URL =
      'https://caselaw.nationalarchives.gov.uk'

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

describe('readRampartDetectionConfig', () => {
  it('reads detection settings without requiring the rest of the API environment', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.DATABASE_URL
    delete process.env.BETTER_AUTH_SECRET
    delete process.env.MEILISEARCH_HOST
    delete process.env.OBITER_RESEND_API_KEY
    delete process.env.OBITER_RAMPART_MODEL
    delete process.env.OBITER_RAMPART_REVISION
    delete process.env.OBITER_RAMPART_MIN_SCORE
    delete process.env.OBITER_RAMPART_CHUNK_TOKENS
    process.env.OBITER_RAMPART_CACHE_DIR = '/tmp/rampart-cache'

    // The prefetch script runs where production secrets are absent, so it must
    // not inherit readApiEnv's requirements.
    expect(() => readApiEnv()).toThrow(/Missing required production/)
    expect(readRampartDetectionConfig()).toEqual({
      model: 'qarlus/rampart',
      revision: 'c3221c5cd838eb69a249ab40f8b442483865f233',
      cacheDir: '/tmp/rampart-cache',
      minScore: 0.4,
      chunkTokens: 400,
    })
  })
})
