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

describe('GET /api/search/legislation/<identity> (Act page)', () => {
  const actDocument = {
    identity: 'ukpga/2010/15',
    actType: 'ukpga',
    year: 2010,
    number: 15,
    title: 'Equality Act 2010',
    sourceUrl: 'https://www.legislation.gov.uk/ukpga/2010/15',
    extent: 'E+W+S',
  }

  function createActApp(documentRows = [actDocument]) {
    const pool = {
      query: vi.fn(async (text: string) => {
        if (text.includes('from legislation_provisions')) {
          return {
            rows: [
              {
                label: 's. 13',
                labelPath: 'section/13',
                extent: 'E+W+S',
                hasUnappliedEffects: false,
                docOrder: 0,
              },
              {
                label: 's. 14',
                labelPath: 'section/14',
                extent: 'E+W+S',
                hasUnappliedEffects: true,
                docOrder: 1,
              },
            ],
          }
        }
        return { rows: documentRows }
      }),
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

  it('serves the Act contents in document order with counts', async () => {
    const response = await createActApp().request(
      '/api/search/legislation/ukpga/2010/15',
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      act: {
        title: string
        chapter: string
        totalCount: number
        withheldCount: number
        contents: Array<{ label: string; href: string; withheld: boolean }>
      }
    }
    expect(body.act.title).toBe('Equality Act 2010')
    expect(body.act.chapter).toBe('2010 c. 15')
    expect(body.act.totalCount).toBe(2)
    expect(body.act.withheldCount).toBe(1)
    expect(body.act.contents.map((entry) => entry.label)).toEqual([
      's. 13',
      's. 14',
    ])
    expect(body.act.contents[0]?.href).toBe('/ln/ukpga/2010/15/section/13')
    expect(body.act.contents[0]?.withheld).toBe(false)
    expect(body.act.contents[1]?.withheld).toBe(true)
  })

  it('still routes a provision path to the provision page', async () => {
    const response = await createActApp().request(
      '/api/search/legislation/ukpga/2010/15/section/13',
    )
    expect(response.status).toBe(200)
    const body = (await response.json()) as { provision?: unknown }
    expect(body.provision).toBeDefined()
  })

  it('returns 404 with document_not_found for an unheld Act', async () => {
    const response = await createActApp([]).request(
      '/api/search/legislation/ukpga/2099/1',
    )
    expect(response.status).toBe(404)
    expect(await response.json()).toMatchObject({
      error: {
        code: 'document_not_found',
        message: 'Legislation Act was not found.',
      },
    })
  })
})
