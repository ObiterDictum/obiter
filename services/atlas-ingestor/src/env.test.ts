import { afterEach, describe, expect, it } from 'vitest'
import { readAtlasIngestorEnv } from './env'

const originalEnv = { ...process.env }

afterEach(() => {
  process.env = { ...originalEnv }
})

describe('readAtlasIngestorEnv', () => {
  it('uses local development defaults', () => {
    process.env.NODE_ENV = 'development'
    delete process.env.MEILISEARCH_HOST
    delete process.env.MEILISEARCH_ADMIN_API_KEY
    delete process.env.ATLAS_AUTHORITIES_INDEX

    const env = readAtlasIngestorEnv()

    expect(env.meilisearchHost).toBe('http://localhost:7700')
    expect(env.meilisearchAdminApiKey).toBe('dev-key')
    expect(env.atlasAuthoritiesIndex).toBe('atlas_authorities')
  })

  it('requires hosted search values in production', () => {
    process.env.NODE_ENV = 'production'
    delete process.env.MEILISEARCH_HOST
    delete process.env.MEILISEARCH_ADMIN_API_KEY
    delete process.env.ATLAS_AUTHORITIES_INDEX

    expect(() => readAtlasIngestorEnv()).toThrow(
      'Missing required production environment values',
    )
  })

  it('does not allow the legacy Meilisearch API key in production', () => {
    process.env.NODE_ENV = 'production'
    process.env.MEILISEARCH_HOST = 'https://search.ormont.example'
    process.env.MEILISEARCH_API_KEY = '0123456789abcdef'
    delete process.env.MEILISEARCH_ADMIN_API_KEY
    process.env.ATLAS_AUTHORITIES_INDEX = 'atlas_authorities'

    expect(() => readAtlasIngestorEnv()).toThrow(
      'Missing required production environment values: MEILISEARCH_ADMIN_API_KEY',
    )
  })

  it('uses the legacy Meilisearch API key only outside production', () => {
    process.env.NODE_ENV = 'development'
    process.env.MEILISEARCH_API_KEY = 'legacy-dev-key'
    delete process.env.MEILISEARCH_ADMIN_API_KEY

    const env = readAtlasIngestorEnv()

    expect(env.meilisearchAdminApiKey).toBe('legacy-dev-key')
  })

  it('rejects invalid URLs, secrets, and index names', () => {
    process.env.NODE_ENV = 'production'
    process.env.MEILISEARCH_HOST = 'not a url'
    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef'
    process.env.ATLAS_AUTHORITIES_INDEX = 'atlas_authorities'

    expect(() => readAtlasIngestorEnv()).toThrow('MEILISEARCH_HOST must be a valid URL.')

    process.env.MEILISEARCH_HOST = 'https://search.ormont.example/'
    process.env.MEILISEARCH_ADMIN_API_KEY = ' short '

    expect(() => readAtlasIngestorEnv()).toThrow(
      'MEILISEARCH_ADMIN_API_KEY must not be blank or padded with whitespace.',
    )

    process.env.MEILISEARCH_ADMIN_API_KEY = '0123456789abcdef'
    process.env.ATLAS_AUTHORITIES_INDEX = 'atlas authorities'

    expect(() => readAtlasIngestorEnv()).toThrow(
      'ATLAS_AUTHORITIES_INDEX may only contain letters, numbers, underscores, and hyphens.',
    )
  })
})
