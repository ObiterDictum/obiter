import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

// The real module's export names as undefined: bun links named imports
// statically and rejects a mock that omits one, while vitest left an
// unlisted export undefined. Overrides win.
const obiterSearchClientModuleKeys = Object.fromEntries(
  Object.keys(await import('@obiter/search-client')).map((key) => [
    key,
    undefined,
  ]),
)
mock.module('@obiter/search-client', () =>
  Object.assign(
    { ...obiterSearchClientModuleKeys },
    (() => ({
      createClient: vi.fn(() => ({ id: 'client' })),
      createIndex: vi.fn(async () => ({ taskUid: 1 })),
      indexDocuments: vi.fn(
        async (_client, _indexName, documents: unknown[]) => ({
          indexedCount: documents.length,
          failedCount: 0,
          errors: [],
        }),
      ),
    }))(),
  ),
)

// Loaded after the registrations above: bun does not hoist mock.module the
// way vi.mock was hoisted, and these modules capture mocked imports at
// module scope, so they must evaluate once the mocks are in place.
const { runBoundedSampleIndexing } = await import('./index')

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
