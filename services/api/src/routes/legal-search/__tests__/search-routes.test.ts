import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createLegalSearchRoutes } from '../search-routes'
import { createTestApiEnv } from '../../../test-api-env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(),
}))

vi.mock('@obiter/search-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@obiter/search-client')>()),
  ...searchClientMock,
}))

const env = createTestApiEnv()

function statsClient(getStats: () => Promise<{ numberOfDocuments: number }>) {
  return { index: () => ({ getStats }) }
}

type IndexStats = { numberOfDocuments: number }

function twoIndexClient(options: {
  legalAuthorities: IndexStats | Error
  legislationProvisions: IndexStats | Error
}) {
  return {
    index: (indexName: string) => ({
      getStats: async () => {
        const outcome =
          indexName === 'legislation_provisions'
            ? options.legislationProvisions
            : options.legalAuthorities
        if (outcome instanceof Error) throw outcome
        return outcome
      },
    }),
  }
}

beforeEach(() => {
  searchClientMock.createClient.mockReset()
})

describe('GET /api/search/readiness', () => {
  it('reports a populated index as ready with its document count', async () => {
    searchClientMock.createClient.mockReturnValue(
      statsClient(async () => ({ numberOfDocuments: 7 })),
    )
    const app = createLegalSearchRoutes(env)

    const response = await app.request('/api/search/readiness')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      index: 'legal_authorities',
      status: 'ready',
      exists: true,
      documentCount: 7,
      indexes: [
        {
          index: 'legal_authorities',
          status: 'ready',
          exists: true,
          documentCount: 7,
        },
        {
          index: 'legislation_provisions',
          status: 'ready',
          exists: true,
          documentCount: 7,
        },
      ],
    })
  })

  it('reports an existing but empty index as empty', async () => {
    searchClientMock.createClient.mockReturnValue(
      statsClient(async () => ({ numberOfDocuments: 0 })),
    )
    const app = createLegalSearchRoutes(env)

    const response = await app.request('/api/search/readiness')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      index: 'legal_authorities',
      status: 'empty',
      exists: true,
      documentCount: 0,
      indexes: [
        {
          index: 'legal_authorities',
          status: 'empty',
          exists: true,
          documentCount: 0,
        },
        {
          index: 'legislation_provisions',
          status: 'empty',
          exists: true,
          documentCount: 0,
        },
      ],
    })
  })

  it('reports rejected credentials as unreachable with the provider reason', async () => {
    const denied = Object.assign(new Error('Invalid API key.'), {
      code: 'invalid_api_key',
    })
    searchClientMock.createClient.mockReturnValue(
      statsClient(async () => {
        throw denied
      }),
    )
    const app = createLegalSearchRoutes(env)

    const response = await app.request('/api/search/readiness')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      index: 'legal_authorities',
      status: 'unreachable',
      exists: false,
      documentCount: null,
      reason: 'invalid_api_key',
      indexes: [
        {
          index: 'legal_authorities',
          status: 'unreachable',
          exists: false,
          documentCount: null,
          reason: 'invalid_api_key',
        },
        {
          index: 'legislation_provisions',
          status: 'unreachable',
          exists: false,
          documentCount: null,
          reason: 'invalid_api_key',
        },
      ],
    })
  })

  it('reports an empty legislation index beside a ready authorities index', async () => {
    searchClientMock.createClient.mockReturnValue(
      twoIndexClient({
        legalAuthorities: { numberOfDocuments: 37938 },
        legislationProvisions: { numberOfDocuments: 0 },
      }),
    )
    const app = createLegalSearchRoutes(env)

    const response = await app.request('/api/search/readiness')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      index: 'legal_authorities',
      status: 'ready',
      exists: true,
      documentCount: 37938,
      indexes: [
        {
          index: 'legal_authorities',
          status: 'ready',
          exists: true,
          documentCount: 37938,
        },
        {
          index: 'legislation_provisions',
          status: 'empty',
          exists: true,
          documentCount: 0,
        },
      ],
    })
  })

  it('reports a missing legislation index beside a ready authorities index', async () => {
    const missing = Object.assign(new Error('Index not found.'), {
      code: 'index_not_found',
    })
    searchClientMock.createClient.mockReturnValue(
      twoIndexClient({
        legalAuthorities: { numberOfDocuments: 37938 },
        legislationProvisions: missing,
      }),
    )
    const app = createLegalSearchRoutes(env)

    const response = await app.request('/api/search/readiness')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      index: 'legal_authorities',
      status: 'ready',
      exists: true,
      documentCount: 37938,
      indexes: [
        {
          index: 'legal_authorities',
          status: 'ready',
          exists: true,
          documentCount: 37938,
        },
        {
          index: 'legislation_provisions',
          status: 'missing',
          exists: false,
          documentCount: 0,
          reason: 'index_not_found',
        },
      ],
    })
  })

  it('reports an unreachable legislation index beside a ready authorities index', async () => {
    const denied = Object.assign(new Error('Invalid API key.'), {
      code: 'invalid_api_key',
    })
    searchClientMock.createClient.mockReturnValue(
      twoIndexClient({
        legalAuthorities: { numberOfDocuments: 37938 },
        legislationProvisions: denied,
      }),
    )
    const app = createLegalSearchRoutes(env)

    const response = await app.request('/api/search/readiness')

    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      index: string
      status: string
      documentCount: number | null
      indexes: unknown
    }
    expect(body.index).toBe('legal_authorities')
    expect(body.status).toBe('ready')
    expect(body.documentCount).toBe(37938)
    expect(body.indexes).toEqual([
      {
        index: 'legal_authorities',
        status: 'ready',
        exists: true,
        documentCount: 37938,
      },
      {
        index: 'legislation_provisions',
        status: 'unreachable',
        exists: false,
        documentCount: null,
        reason: 'invalid_api_key',
      },
    ])
  })
})
