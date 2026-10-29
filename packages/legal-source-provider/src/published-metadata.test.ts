import { describe, expect, it } from 'bun:test'
import { createMojRateLimiter } from './rate-limiter'
import {
  fetchPublishedCaseLawMetadata,
  type PublishedMetadataSourceRecord,
} from './published-metadata'

const env = { mojFindCaseLawBaseUrl: 'https://caselaw.nationalarchives.gov.uk' }

const record: PublishedMetadataSourceRecord = {
  court: 'uksc',
  xmlUri: '/uksc/2026/31/data.xml',
  sourceUri: '/uksc/2026/31',
}

const judgmentXml = `<akomaNtoso><judgment><meta/><header>
  <p class="JudgmentJudges"><judge refersTo="#judge-lord-briggs">Lord Briggs</judge><judge refersTo="#judge-lady-rose">Lady Rose</judge></p>
</header></judgment></akomaNtoso>`

const pressSummaryXml = `<akomaNtoso><doc name="pressSummary"><meta><proprietary>
  <uk:summaryOf>https://caselaw.nationalarchives.gov.uk/id/uksc/2026/31</uk:summaryOf>
</proprietary></meta><mainBody><level><content><p>This appeal concerns the right to manage.</p></content></level></mainBody></doc></akomaNtoso>`

const judgmentPage = `<html><body><a href="/uksc/2026/31/press-summary" class="button">View Press Summary</a></body></html>`

/** Routes by URL path; anything unrouted is a 404 and is still recorded. */
function provider(routes: Record<string, string>) {
  const calls: string[] = []
  const fetchImpl = async (url: URL) => {
    calls.push(new URL(url).pathname)
    const body = routes[new URL(url).pathname]
    return body === undefined
      ? new Response('missing', { status: 404 })
      : new Response(body, { status: 200 })
  }
  return { calls, fetchImpl }
}

describe('fetchPublishedCaseLawMetadata', () => {
  it('reads the bench and the linked press summary for a UKSC judgment', async () => {
    const { calls, fetchImpl } = provider({
      '/uksc/2026/31/data.xml': judgmentXml,
      '/uksc/2026/31': judgmentPage,
      '/uksc/2026/31/press-summary/data.xml': pressSummaryXml,
    })

    const result = await fetchPublishedCaseLawMetadata(
      env,
      record,
      createMojRateLimiter(1000),
      { fetchImpl },
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.metadata.judges).toEqual([
      { name: 'Lord Briggs', source: 'fcl_metadata', field: 'legaldocml:judge' },
      { name: 'Lady Rose', source: 'fcl_metadata', field: 'legaldocml:judge' },
    ])
    expect(result.metadata.summary?.paragraphs).toEqual([
      'This appeal concerns the right to manage.',
    ])
    expect(result.metadata.summary?.sourceUrl).toBe(
      'https://caselaw.nationalarchives.gov.uk/uksc/2026/31/press-summary',
    )
    expect(calls).toHaveLength(3)
  })

  it("refuses a press summary whose own summaryOf names another judgment", async () => {
    const { fetchImpl } = provider({
      '/uksc/2026/31/data.xml': judgmentXml,
      '/uksc/2026/31': judgmentPage,
      '/uksc/2026/31/press-summary/data.xml': pressSummaryXml.replace(
        '/id/uksc/2026/31',
        '/id/uksc/2026/30',
      ),
    })

    const result = await fetchPublishedCaseLawMetadata(
      env,
      record,
      createMojRateLimiter(1000),
      { fetchImpl },
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    // The bench is still this judgment's; the other case's summary is not.
    expect(result.metadata.judges).toHaveLength(2)
    expect(result.metadata.summary).toBeNull()
  })

  it('does not fetch the judgment page for a court that publishes no summary', async () => {
    const { calls, fetchImpl } = provider({
      '/ewca/civ/2026/1147/data.xml': judgmentXml,
    })

    const result = await fetchPublishedCaseLawMetadata(
      env,
      {
        court: 'ewca-civ',
        xmlUri: '/ewca/civ/2026/1147/data.xml',
        sourceUri: '/ewca/civ/2026/1147',
      },
      createMojRateLimiter(1000),
      { fetchImpl },
    )

    expect(result.status).toBe('ok')
    if (result.status !== 'ok') return
    expect(result.metadata.summary).toBeNull()
    expect(calls).toEqual(['/ewca/civ/2026/1147/data.xml'])
  })

  it('reports a missing judgment body instead of a metadata record', async () => {
    const { fetchImpl } = provider({})

    const result = await fetchPublishedCaseLawMetadata(
      env,
      record,
      createMojRateLimiter(1000),
      { fetchImpl },
    )

    expect(result).toEqual({ status: 'skipped', reason: 'http_error' })
  })
})
