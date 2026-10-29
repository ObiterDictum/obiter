import { describe, expect, it } from 'bun:test'
import {
  backfillPublishedMetadata,
  createMetadataBackfillDeps,
  type MetadataBackfillDeps,
} from './metadata-backfill'
import type { Db } from './bulk-ingest'

const judgmentXml = `<akomaNtoso><judgment><meta/><header>
  <p class="JudgmentJudges"><judge refersTo="#judge-lord-briggs">Lord Briggs</judge></p>
</header></judgment></akomaNtoso>`

const judgmentPage = `<html><body><a href="/uksc/2026/31/press-summary">View Press Summary</a></body></html>`

const pressSummaryXml = `<akomaNtoso><doc name="pressSummary"><meta><proprietary>
  <uk:summaryOf>https://caselaw.nationalarchives.gov.uk/id/uksc/2026/31</uk:summaryOf>
</proprietary></meta><mainBody><level><content><p>This appeal concerns the right to manage.</p></content></level></mainBody></doc></akomaNtoso>`

interface RecordedQuery {
  text: string
  params: unknown[]
}

function fakePool(pendingRows: Array<Record<string, unknown>>) {
  const queries: RecordedQuery[] = []
  const pool = {
    query: async (text: string, params: unknown[] = []) => {
      queries.push({ text, params })
      if (text.includes('count(*)')) {
        return { rows: [{ count: String(pendingRows.length) }] }
      }
      if (text.includes('where metadata_fetched_at is null')) {
        return { rows: pendingRows }
      }
      return { rows: [] }
    },
  } as unknown as Db
  return { pool, queries }
}

function deps(pool: Db, routes: Record<string, string>): MetadataBackfillDeps {
  return createMetadataBackfillDeps(
    pool,
    { mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk' },
    1000,
    {
      gapMs: 0,
      sleep: async () => {},
      fetchImpl: async (url: URL) => {
        const body = routes[new URL(url).pathname]
        return body === undefined
          ? new Response('missing', { status: 404 })
          : new Response(body, { status: 200 })
      },
    },
  )
}

const row = {
  document_id: 'uksc-2026-31',
  court: 'uksc',
  xml_uri: '/uksc/2026/31/data.xml',
  source_uri: '/uksc/2026/31',
}

describe('backfillPublishedMetadata', () => {
  it('stamps the row and stores the bench and the published summary', async () => {
    const { pool, queries } = fakePool([row])
    const report = await backfillPublishedMetadata(
      deps(pool, {
        '/uksc/2026/31/data.xml': judgmentXml,
        '/uksc/2026/31': judgmentPage,
        '/uksc/2026/31/press-summary/data.xml': pressSummaryXml,
      }),
      { limit: 10 },
    )

    const update = queries.find((query) =>
      query.text.includes('update legal_source_documents'),
    )
    expect(update?.params[0]).toBe('uksc-2026-31')
    expect(JSON.parse(String(update?.params[1]))).toEqual([
      {
        name: 'Lord Briggs',
        source: 'fcl_metadata',
        field: 'legaldocml:judge',
      },
    ])
    expect(JSON.parse(String(update?.params[2])).paragraphs).toEqual([
      'This appeal concerns the right to manage.',
    ])
    expect(report).toMatchObject({
      fetched: 1,
      judgesFound: 1,
      summaryFound: 1,
      none: 0,
      remaining: 0,
      failed: [],
    })
  })

  it('leaves a row unstamped when the provider could not be read', async () => {
    const { pool, queries } = fakePool([row])
    const report = await backfillPublishedMetadata(deps(pool, {}), {
      limit: 10,
    })

    expect(
      queries.some((query) =>
        query.text.includes('update legal_source_documents'),
      ),
    ).toBe(false)
    expect(report).toMatchObject({ fetched: 0, remaining: 1 })
    expect(report.failed).toEqual([
      { documentId: 'uksc-2026-31', reason: 'provider http_error' },
    ])
  })

  it('fetches nothing and writes nothing on a dry run', async () => {
    const { pool, queries } = fakePool([row])
    const report = await backfillPublishedMetadata(
      deps(pool, {
        '/uksc/2026/31/data.xml': judgmentXml,
        '/uksc/2026/31': judgmentPage,
        '/uksc/2026/31/press-summary/data.xml': pressSummaryXml,
      }),
      { limit: 10, dryRun: true },
    )

    expect(queries).toHaveLength(2)
    expect(report).toMatchObject({
      dryRun: true,
      pending: 1,
      documentIds: ['uksc-2026-31'],
      fetched: 0,
      remaining: 1,
    })
  })

  it('records a judgment that publishes neither field as read, not pending', async () => {
    const { pool, queries } = fakePool([
      { ...row, xml_uri: null, court: 'ewca-civ' },
    ])
    const report = await backfillPublishedMetadata(deps(pool, {}), {
      limit: 10,
    })

    const update = queries.find((query) =>
      query.text.includes('update legal_source_documents'),
    )
    expect(update?.params.slice(1)).toEqual([null, null])
    expect(report).toMatchObject({
      fetched: 1,
      judgesFound: 0,
      summaryFound: 0,
      none: 1,
    })
  })
})
