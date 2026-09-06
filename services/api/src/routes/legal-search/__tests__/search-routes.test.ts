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
    })
  })
})
