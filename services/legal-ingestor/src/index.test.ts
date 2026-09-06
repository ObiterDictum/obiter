import { describe, expect, it, vi } from 'vitest'
import { runBoundedSampleIndexing } from './index'

vi.mock('@obiter/search-client', () => ({
  createClient: vi.fn(() => ({ id: 'client' })),
  createIndex: vi.fn(async () => ({ taskUid: 1 })),
  indexDocuments: vi.fn(async (_client, _indexName, documents: unknown[]) => ({
    indexedCount: documents.length,
    failedCount: 0,
    errors: [],
  })),
}))

describe('runBoundedSampleIndexing', () => {
  it('indexes only the local bounded fixture', async () => {
    const report = await runBoundedSampleIndexing({
      meilisearchHost: 'http://localhost:7700',
      meilisearchAdminApiKey: 'dev-key',
      legalAuthoritiesIndex: 'legal_authorities_fixtures',
      mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
      mojFindCaseLawRateLimit: 1000,
      databaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
      nodeEnv: 'test',
    })

    expect(report).toEqual({
      indexedCount: 3,
      failedCount: 0,
      errors: [],
    })
  })

  it('refuses the product index', async () => {
    await expect(
      runBoundedSampleIndexing({
        meilisearchHost: 'http://localhost:7700',
        meilisearchAdminApiKey: 'dev-key',
        legalAuthoritiesIndex: 'legal_authorities',
        mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk',
        mojFindCaseLawRateLimit: 1000,
        databaseUrl: 'postgres://obiter:obiter@localhost:5432/obiter',
        nodeEnv: 'test',
      }),
    ).rejects.toThrow('Refusing to seed fixtures into product index')
  })
})
