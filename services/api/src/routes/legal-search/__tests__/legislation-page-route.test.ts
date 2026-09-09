import { describe, expect, it, vi } from 'vitest'
import { Hono } from 'hono'
import { createLegalSearchProxyRoutes } from '../proxy-routes'
import { createTestApiEnv } from '../../../test-api-env'

const searchClientMock = vi.hoisted(() => ({
  createClient: vi.fn(() => ({ id: 'meili-client' })),
  indexDocuments: vi.fn(),
  getDocument: vi.fn(),
  search: vi.fn(),
}))

vi.mock('@obiter/search-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@obiter/search-client')>()),
  ...searchClientMock,
}))

const currentProvision = {
  id: 'ukpga/2010/15/section/13',
  documentIdentity: 'ukpga/2010/15',
  labelPath: 'section/13',
  label: 's. 13',
  extent: 'E+W+S',
  text: 'Direct discrimination applies here.',
  hasUnappliedEffects: false,
  effectsCheckedAt: '2026-09-01T00:00:00Z',
  title: 'Equality Act 2010',
  year: 2010,
  sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
}

function createApp(provision = currentProvision) {
  const pool = {
    query: vi.fn(async () => ({ rows: [provision] })),
  }
  const proxy = createLegalSearchProxyRoutes(createTestApiEnv(), undefined, {
    legislation: {
      pool: pool as never,
      indexName: 'legislation_provisions',
    },
  })
  const app = new Hono<{
    Variables: { requestId: string; user: { id: string } | null }
  }>()
  app.use('*', async (c, next) => {
    c.set('requestId', 'req_test')
    c.set('user', null)
    await next()
  })
  app.route('/', proxy)
  return app
}

describe('GET /api/search/legislation/*', () => {
  it('serves a current provision page to anonymous callers', async () => {
    const response = await createApp().request(
      '/api/search/legislation/ukpga/2010/15/section/13',
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      provision: { text?: string; legislationStatus: string }
    }
    expect(body.provision.legislationStatus).toBe('current')
    expect(body.provision.text).toContain('Direct discrimination')
  })

  it('withholds amended text on the page too', async () => {
    const response = await createApp({
      ...currentProvision,
      id: 'ukpga/2010/15/section/80',
      labelPath: 'section/80',
      label: 's. 80',
      hasUnappliedEffects: true,
      text: 'Stale wording',
    }).request('/api/search/legislation/ukpga/2010/15/section/80')
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      provision: { text?: string; legislationStatus: string }
    }
    expect(body.provision.legislationStatus).toBe('amended_not_held')
    expect(body.provision).not.toHaveProperty('text')
  })

  it('rejects an unparseable path', async () => {
    const response = await createApp().request(
      '/api/search/legislation/not-a-provision',
    )
    expect(response.status).toBe(400)
  })
})
