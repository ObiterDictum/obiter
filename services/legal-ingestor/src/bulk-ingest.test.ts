import { describe, expect, it, vi } from 'vitest'
import type { LegalAuthority } from '@obiter/legal-schema'
import type {
  AtomEntry,
  ProviderDocumentResult,
  ProviderSourceMetadata,
} from '@obiter/legal-source-provider'
import { parseFindCaseLawAtom } from '@obiter/legal-source-provider'
import {
  buildAtomPageUrl,
  buildScopeKey,
  createDeps,
  defaultScopes,
  ingestOne,
  ingestScope,
  type Db,
  type IngestDeps,
} from './bulk-ingest'

function entry(overrides?: Partial<AtomEntry>): AtomEntry {
  return {
    title: '[2024] UKSC 1',
    neutralCitation: '[2024] UKSC 1',
    court: 'uksc',
    dateDecided: '2024-01-01',
    uri: '/uksc/2024/1',
    sourceUri: '/uksc/2024/1',
    xmlUri: '/uksc/2024/1/data.xml',
    pdfUri: null,
    contentHash: 'abc123',
    rawXml: '<entry/>',
    ...overrides,
  }
}

function provider(
  overrides?: Partial<ProviderSourceMetadata>,
): ProviderSourceMetadata {
  return {
    documentUri: '/uksc/2024/1',
    sourceUri: '/uksc/2024/1',
    xmlUri: '/uksc/2024/1/data.xml',
    pdfUri: null,
    contentHash: 'abc123',
    rawAtomEntry: '<entry/>',
    ...overrides,
  }
}

function document(): LegalAuthority {
  return {
    id: 'uksc-2024-1',
    title: '[2024] UKSC 1',
    neutralCitation: '[2024] UKSC 1',
    court: 'uksc',
    jurisdiction: 'england-and-wales',
    dateDecided: '2024-01-01',
    sourceType: 'judgment',
    sourceUrl: 'https://caselaw.nationalarchives.gov.uk/uksc/2024/1',
  }
}

interface RecordedQuery {
  text: string
  params: unknown[]
}

// The pool is an external storage boundary; the behaviour under test is the
// ingest walk, so a recording fake stands in for Postgres here.
function fakePool(
  handler: (text: string, params: unknown[]) => { rows: unknown[] },
) {
  const queries: RecordedQuery[] = []
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params })
      return handler(text, params) as { rows: never[] }
    },
  } as unknown as Db
  return { pool, queries }
}

function deps(
  overrides?: Partial<IngestDeps> & {
    rows?: (text: string, params: unknown[]) => { rows: unknown[] }
  },
) {
  const { pool, queries } = fakePool(
    (text, params) => overrides?.rows?.(text, params) ?? { rows: [] },
  )
  const sleep = vi.fn(async (_ms: number) => {})
  const base: IngestDeps = {
    pool,
    baseUrl: 'https://caselaw.nationalarchives.gov.uk',
    limiter: { take: () => ({ allowed: true as const, retryAfterSeconds: 0 }) },
    gapMs: 0,
    sleep,
    fetchImpl: (async () => {
      throw new Error('fetch must be stubbed per test')
    }) as typeof fetch,
    fetchDetail: async () => ({ status: 'skipped' }) as ProviderDocumentResult,
    ...overrides,
  }
  return { deps: base, queries, sleep }
}

describe('defaultScopes', () => {
  it('covers the measured scope with the EWHC cut-off', () => {
    expect(defaultScopes.map((scope) => scope.court)).toEqual([
      'uksc',
      'ukpc',
      'ewca-civ',
      'ewca-crim',
      'ewhc-admin',
      'ewhc-admlty',
      'ewhc-ch',
      'ewhc-comm',
      'ewhc-fam',
      'ewhc-ipec',
      'ewhc-kb',
      'ewhc-mercantile',
      'ewhc-pat',
      'ewhc-scco',
      'ewhc-tcc',
    ])
    expect(defaultScopes.find((scope) => scope.court === 'uksc')).toEqual({
      court: 'uksc',
    })
    for (const scope of defaultScopes.filter((item) =>
      item.court.startsWith('ewhc'),
    )) {
      expect(scope.dateFrom).toBe('2020-01-01')
    }
    expect(buildScopeKey({ court: 'uksc' })).toBe('uksc||')
  })

  it('builds slash-form atom page urls', () => {
    expect(
      buildAtomPageUrl(
        'https://example.test',
        { court: 'ewca-civ' },
        2,
      ).toString(),
    ).toBe('https://example.test/atom.xml?court=ewca%2Fciv&page=2')
  })
})

describe('ingestOne', () => {
  it('skips unchanged documents without fetching the body', async () => {
    const fetchDetail = vi.fn()
    const { deps: testDeps, queries } = deps({
      fetchDetail,
      rows: (text) =>
        text.includes('legal_source_documents')
          ? { rows: [{ content_hash: 'abc123' }] }
          : { rows: [] },
    })
    const outcome = await ingestOne(testDeps, entry())
    expect(outcome).toEqual({
      status: 'skipped-unchanged',
      documentId: 'uksc-2024-1',
    })
    expect(fetchDetail).not.toHaveBeenCalled()
    expect(
      queries.some((query) =>
        query.text.includes('insert into legal_source_documents'),
      ),
    ).toBe(false)
  })

  it('stores new documents with licensing provenance', async () => {
    const { deps: testDeps, queries } = deps({
      fetchDetail: async () => ({
        status: 'ok',
        document: document(),
        provider: provider(),
        parser: { id: 'legaldocml', version: 1 },
      }),
    })
    const outcome = await ingestOne(testDeps, entry())
    expect(outcome).toEqual({ status: 'stored', documentId: 'uksc-2024-1' })
    const insert = queries.find((query) =>
      query.text.includes('insert into legal_source_documents'),
    )
    expect(insert?.text).toContain('document_json')
    const storedProvider = JSON.parse(String(insert?.params[3])) as Record<
      string,
      string
    >
    expect(storedProvider.provider).toBe('find-case-law')
    expect(storedProvider.licenceClass).toBe('tna-transactional-2026-07-15')
    expect(storedProvider.acquiredAt).toBeTruthy()
    expect(storedProvider.sourceUrl).toContain('/uksc/2024/1')
  })

  it('stores PDF-only documents as summaries with a reason', async () => {
    const { deps: testDeps, queries } = deps({
      fetchDetail: async () => ({ status: 'skipped' }),
    })
    const outcome = await ingestOne(testDeps, entry({ xmlUri: null }))
    expect(outcome.status).toBe('skipped-no-fulltext')
    expect(
      outcome.status === 'skipped-no-fulltext' && outcome.reason,
    ).toContain('PDF')
    const insert = queries.find((query) =>
      query.text.includes('insert into legal_source_documents'),
    )
    expect(insert?.text).not.toContain('document_json')
  })

  it('retries rate-limited details then stores', async () => {
    const fetchDetail = vi
      .fn<() => Promise<ProviderDocumentResult>>()
      .mockResolvedValueOnce({ status: 'rate_limited', retryAfter: '0' })
      .mockResolvedValueOnce({
        status: 'ok',
        document: document(),
        provider: provider(),
        parser: { id: 'legaldocml', version: 1 },
      })
    const { deps: testDeps, sleep } = deps({ fetchDetail })
    const outcome = await ingestOne(testDeps, entry())
    expect(outcome.status).toBe('stored')
    expect(fetchDetail).toHaveBeenCalledTimes(2)
    expect(sleep).toHaveBeenCalled()
  })
})

describe('ingestScope', () => {
  const atomFeed = (uris: string[]) =>
    `<feed>${uris.map((uri) => `<entry><title>[2024] UKSC 1</title><id>https://caselaw.nationalarchives.gov.uk${uri}</id><link rel="alternate" href="${uri}"/><tna:uri xmlns:tna="x">${uri}</tna:uri><published>2024-01-01</published></entry>`).join('')}</feed>`

  function scopeDeps(
    pages: string[],
    rows?: (text: string, params: unknown[]) => { rows: unknown[] },
  ) {
    const requested: string[] = []
    const { deps: testDeps, queries } = deps({
      rows: (text, params) => {
        if (rows) return rows(text, params)
        if (
          text.includes('legal_ingestor_progress') &&
          text.startsWith('select')
        )
          return { rows: [] }
        if (
          text.includes('legal_source_documents') &&
          text.startsWith('select')
        )
          return { rows: [] }
        return { rows: [] }
      },
      fetchImpl: (async (url: string | URL | Request) => {
        requested.push(String(url))
        const body = pages.shift() ?? '<feed></feed>'
        return new Response(body, { status: 200 })
      }) as typeof fetch,
      fetchDetail: async (item) => ({
        status: 'ok',
        document: {
          ...document(),
          id: item.uri
            .replace(/[^a-z0-9]+/gi, '-')
            .replace(/^-|-$/g, '')
            .toLowerCase(),
        },
        provider: provider({
          documentUri: item.uri,
          sourceUri: item.sourceUri,
        }),
        parser: { id: 'legaldocml', version: 1 },
      }),
    })
    return { testDeps, queries, requested }
  }

  it('walks pages until an empty page and records progress without double-counting', async () => {
    const { testDeps, queries, requested } = scopeDeps([
      atomFeed(['/uksc/2024/1', '/uksc/2024/2']),
      atomFeed(['/uksc/2024/3']),
    ])
    const report = await ingestScope(
      testDeps,
      { court: 'uksc' },
      { maxPages: 5 },
    )
    expect(report.stored).toBe(3)
    expect(report.pagesCompleted).toBe(2)
    expect(requested).toHaveLength(3)
    const progress = queries.filter((query) =>
      query.text.includes('insert into legal_ingestor_progress'),
    )
    expect(progress.length).toBeGreaterThan(0)
    expect(progress.at(-1)?.params[4]).toBe(2)
    const flushedStored = progress.reduce(
      (sum, query) => sum + Number(query.params[5]),
      0,
    )
    expect(flushedStored).toBe(3)
  })

  it('resumes after the last completed page, re-polling pages 1..cursor first', async () => {
    const requested: string[] = []
    const { deps: testDeps } = deps({
      rows: (text) => {
        if (
          text.includes('legal_ingestor_progress') &&
          text.startsWith('select')
        )
          return { rows: [{ last_completed_page: 3 }] }
        return { rows: [] }
      },
      fetchImpl: (async (url: string | URL | Request) => {
        requested.push(String(url))
        return new Response('<feed></feed>', { status: 200 })
      }) as typeof fetch,
    })
    const report = await ingestScope(testDeps, { court: 'uksc' })
    expect(report.pagesCompleted).toBe(0)
    // Newest-first feed: page 1 is re-polled for catch-up (empty here, so
    // catch-up stops), then the forward walk continues past the cursor.
    expect(requested).toHaveLength(2)
    expect(requested[0]).toContain('page=1')
    expect(requested[1]).toContain('page=4')
  })

  it('picks up a new page-1 document on re-run of a completed scope', async () => {
    const oldFeed = atomFeed(['/uksc/2024/1'])
    const [oldParsed] = parseFindCaseLawAtom(oldFeed, {
      query: '',
      court: 'uksc',
    })
    expect(oldParsed?.contentHash).toBeTruthy()
    const oldHash = oldParsed?.contentHash ?? ''
    const { testDeps, queries, requested } = scopeDeps(
      [atomFeed(['/uksc/2024/99', '/uksc/2024/1']), '<feed></feed>'],
      (text, params) => {
        if (
          text.includes('legal_ingestor_progress') &&
          text.startsWith('select')
        )
          return { rows: [{ last_completed_page: 1 }] }
        if (
          text.includes('legal_source_documents') &&
          text.startsWith('select')
        )
          return params[0] === 'uksc-2024-1'
            ? { rows: [{ content_hash: oldHash }] }
            : { rows: [] }
        return { rows: [] }
      },
    )
    const report = await ingestScope(testDeps, { court: 'uksc' })
    // Without the catch-up re-poll the run would start at page 2 (empty)
    // and store nothing.
    expect(requested[0]).toContain('page=1')
    expect(report.stored).toBe(1)
    expect(report.skippedUnchanged).toBe(1)
    expect(report.pagesCompleted).toBe(0)
    const storedIds = queries
      .filter((query) =>
        query.text.includes('insert into legal_source_documents'),
      )
      .map((query) => query.params[0])
    expect(storedIds).toEqual(['uksc-2024-99'])
  })

  it('caps a run at maxDocs', async () => {
    const { testDeps } = scopeDeps([
      atomFeed(['/uksc/2024/1', '/uksc/2024/2', '/uksc/2024/3']),
    ])
    const report = await ingestScope(
      testDeps,
      { court: 'uksc' },
      { maxDocs: 2 },
    )
    expect(report.stored).toBe(2)
  })
})

describe('createDeps', () => {
  it('uses the shared sliding-window limiter', async () => {
    const { pool } = fakePool(() => ({ rows: [] }))
    const testDeps = createDeps(
      pool,
      { mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk' },
      1,
      0,
      { sleep: async () => {} },
    )
    expect(testDeps.limiter.take().allowed).toBe(true)
    expect(testDeps.limiter.take().allowed).toBe(false)
  })
})
