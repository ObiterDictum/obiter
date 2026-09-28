import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import {
  fetchMojAuthorityDetail,
  fetchMojAuthorityDocumentFromRecord,
  fetchMojAuthoritySummaries,
} from './moj-provider'
import type { MojRequestBudget, MojRequestCharge } from './rate-limiter'
import type { AtomEntry } from './atom-parser'

/**
 * The provider charges a request budget immediately before each HTTP attempt,
 * so these tests pin the accounting rather than the parsing: one charge per
 * attempted fetch, many charges per operation, and no charge for an attempt
 * that is refused or guarded before dispatch.
 *
 * No provider is reached anywhere here: `fetch` is stubbed globally.
 */

const BASE = 'https://caselaw.nationalarchives.gov.uk'

function countingBudget(
  decide: (attempt: number) => MojRequestCharge = () => ({ status: 'allowed' }),
) {
  let attempts = 0
  const budget: MojRequestBudget = {
    async charge() {
      attempts += 1
      return decide(attempts)
    },
  }
  return { budget, attempts: () => attempts }
}

function entry(overrides: Partial<AtomEntry> = {}): AtomEntry {
  return {
    title: '[2024] UKSC 1',
    neutralCitation: '[2024] UKSC 1',
    court: 'uksc',
    dateDecided: '2024-01-01',
    uri: '/uksc/2024/1',
    sourceUri: '/uksc/2024/1',
    xmlUri: null,
    pdfUri: null,
    contentHash: 'hash',
    rawXml: '<entry/>',
    ...overrides,
  }
}

function atomFeed(uris: string[], next: string | null = null) {
  return `<feed xmlns:tna="https://caselaw.nationalarchives.gov.uk">${uris
    .map(
      (uri) =>
        `<entry><title>[2024] UKSC 1</title><id>${BASE}${uri}</id><link rel="alternate" href="${uri}"/><tna:uri>${uri}</tna:uri><published>2024-01-01</published></entry>`,
    )
    .join('')}${next ? `<link rel="next" href="${next}"/>` : ''}</feed>`
}

function legalDocMl(body: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<akomaNtoso xmlns="http://docs.oasis-open.org/legaldocml/ns/akn/3.0">
  <judgment name="judgment">
    <meta><identification source="#tna"><FRBRWork><FRBRdate date="2019-05-02" name="judgment"/><FRBRname value="Alpha Ltd v Beta Ltd"/></FRBRWork></identification></meta>
    <header><p>Neutral Citation Number: [2019] EWHC 1094 (IPEC)</p></header>
    <judgmentBody><decision>${body}</decision></judgmentBody>
  </judgment>
</akomaNtoso>`
}

const paragraph = (eId: string, num: string, text: string) =>
  `<paragraph eId="${eId}"><num>${num}</num><content><p>${text}</p></content></paragraph>`

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('provider request budget accounting', () => {
  it('charges once per Atom page as an operation paginates', async () => {
    const pages = [
      atomFeed(['/uksc/2024/1', '/uksc/2024/2'], `${BASE}/atom.xml?page=2`),
      atomFeed(['/uksc/2024/3', '/uksc/2024/4'], `${BASE}/atom.xml?page=3`),
      atomFeed(['/uksc/2024/5']),
    ]
    const fetchMock = vi.fn(
      async () => new Response(pages.shift() ?? '<feed/>'),
    )
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget()

    const result = await fetchMojAuthoritySummaries(
      { mojFindCaseLawBaseUrl: BASE },
      { query: '' },
      budget,
    )

    expect(result.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(attempts()).toBe(3)
  })

  it('spends no charge when the budget is unavailable, and reaches no provider', async () => {
    const fetchMock = vi.fn(async () => new Response('<feed/>'))
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget(() => ({
      status: 'unavailable',
    }))

    const result = await fetchMojAuthoritySummaries(
      { mojFindCaseLawBaseUrl: BASE },
      { query: '' },
      budget,
    )

    expect(result.status).toBe('unavailable')
    expect(fetchMock).not.toHaveBeenCalled()
    // Exactly one charge was attempted; the refusal is what stops dispatch.
    expect(attempts()).toBe(1)
  })

  it('spends no charge when the window is full and surfaces a retry wait', async () => {
    const fetchMock = vi.fn(async () => new Response('<feed/>'))
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget(() => ({
      status: 'rate_limited',
      retryAfterSeconds: 7,
    }))

    const result = await fetchMojAuthoritySummaries(
      { mojFindCaseLawBaseUrl: BASE },
      { query: '' },
      budget,
    )

    expect(result).toEqual({ status: 'rate_limited', retryAfter: '7' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(attempts()).toBe(1)
  })

  it('counts an attempted fetch whose network call fails after the charge', async () => {
    const fetchMock = vi.fn(async () => {
      throw new Error('connection reset')
    })
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget()

    const result = await fetchMojAuthoritySummaries(
      { mojFindCaseLawBaseUrl: BASE },
      { query: '' },
      budget,
    )

    expect(result.status).toBe('unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(attempts()).toBe(1)
  })

  it('charges LegalDocML and the HTML fallback as two separate attempts', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('.xml')) return new Response('boom', { status: 500 })
      return new Response(
        '<html><body><p>Fallback paragraph.</p></body></html>',
      )
    })
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget()

    await fetchMojAuthorityDetail(
      { mojFindCaseLawBaseUrl: BASE },
      entry({ xmlUri: '/uksc/2024/1/data.xml' }),
      budget,
      { preferLegalDocMl: true },
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(attempts()).toBe(2)
  })

  it('charges once when LegalDocML succeeds and the HTML page is not fetched', async () => {
    const xml = legalDocMl(paragraph('para_1', '1.', 'First.'))
    const fetchMock = vi.fn(async () => new Response(xml))
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget()

    const result = await fetchMojAuthorityDetail(
      { mojFindCaseLawBaseUrl: BASE },
      entry({ xmlUri: '/uksc/2024/1/data.xml' }),
      budget,
      { preferLegalDocMl: true },
    )

    expect(result.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(attempts()).toBe(1)
  })

  it('charges each source URI it actually attempts during a record re-fetch', async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input)
      if (url.endsWith('.xml')) return new Response('<html><p>x</p></html>')
      return new Response('gone', { status: 404 })
    })
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget()

    await fetchMojAuthorityDocumentFromRecord(
      { mojFindCaseLawBaseUrl: BASE },
      {
        summary: entry() as never,
        provider: {
          documentUri: '/uksc/2024/1',
          sourceUri: '/uksc/2024/1',
          xmlUri: '/uksc/2024/1/data.xml',
          pdfUri: null,
          contentHash: 'hash',
          rawAtomEntry: '',
        },
      },
      budget,
    )

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(attempts()).toBe(2)
  })

  it('spends no charge on an off-origin URI refused before dispatch', async () => {
    const fetchMock = vi.fn(async () => new Response('<html></html>'))
    vi.stubGlobal('fetch', fetchMock)
    const { budget, attempts } = countingBudget()

    const result = await fetchMojAuthorityDocumentFromRecord(
      { mojFindCaseLawBaseUrl: BASE },
      {
        summary: entry() as never,
        provider: {
          documentUri: '/uksc/2024/1',
          sourceUri: 'http://169.254.169.254/stored.html',
          xmlUri: 'http://169.254.169.254/stored.xml',
          pdfUri: null,
          contentHash: 'hash',
          rawAtomEntry: '',
        },
      },
      budget,
    )

    expect(result).toEqual({ status: 'skipped', reason: 'off_origin' })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(attempts()).toBe(0)
  })
})
