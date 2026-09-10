import { afterEach, describe, expect, it, vi } from 'vitest'
import { createMojRateLimiter } from './rate-limiter'
import {
  fetchMojAuthorityDetail,
  fetchMojAuthorityDocumentFromRecord,
  fetchMojAuthoritySummaries,
} from './moj-provider'
import { resolveProviderUrl } from './fetch-safety'
import type { AtomEntry } from './atom-parser'

const BASE = 'https://caselaw.nationalarchives.gov.uk'

function entry(overrides: Partial<AtomEntry> = {}): AtomEntry {
  return {
    title: 'Example',
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

describe('resolveProviderUrl', () => {
  it('keeps a relative path on the provider origin', () => {
    expect(resolveProviderUrl(BASE, '/uksc/2024/1')?.toString()).toBe(
      'https://caselaw.nationalarchives.gov.uk/uksc/2024/1',
    )
  })

  it('keeps an absolute same-origin URL', () => {
    expect(resolveProviderUrl(BASE, `${BASE}/uksc/2024/1`)?.toString()).toBe(
      'https://caselaw.nationalarchives.gov.uk/uksc/2024/1',
    )
  })

  it('upgrades a plaintext same-host link to the base scheme', () => {
    // legislation.gov.uk publishes rel="next" hrefs as http:// on its own
    // host; those must be fetched over https, never in the clear.
    expect(
      resolveProviderUrl(
        'https://www.legislation.gov.uk',
        'http://www.legislation.gov.uk/ukpga/2020/data.feed?page=2',
      )?.toString(),
    ).toBe('https://www.legislation.gov.uk/ukpga/2020/data.feed?page=2')
  })

  it.each([
    ['a different host', 'https://evil.example/steal'],
    [
      'a lookalike suffix host',
      'https://www.legislation.gov.uk.evil.example/x',
    ],
    [
      'another host reached via userinfo',
      'https://www.legislation.gov.uk@evil.example/x',
    ],
    ['a protocol-relative host', '//evil.example/x'],
    ['a non-http scheme', 'file:///etc/passwd'],
    ['a data scheme', 'data:text/plain,secret'],
    ['an explicit foreign port', 'https://www.legislation.gov.uk:8443/x'],
  ])('refuses %s', (_label, candidate) => {
    expect(
      resolveProviderUrl('https://www.legislation.gov.uk', candidate),
    ).toBeNull()
  })

  it('refuses a foreign port when the base itself names a port', () => {
    expect(
      resolveProviderUrl('http://127.0.0.1:3000', 'http://127.0.0.1:3001/x'),
    ).toBeNull()
    expect(resolveProviderUrl('http://127.0.0.1:3000', '/x')?.port).toBe('3000')
  })

  it('strips userinfo from a same-host URL', () => {
    const resolved = resolveProviderUrl(
      BASE,
      'https://user:pass@caselaw.nationalarchives.gov.uk/x',
    )
    expect(resolved?.username).toBe('')
    expect(resolved?.password).toBe('')
    expect(resolved?.pathname).toBe('/x')
  })
})

describe('provider fetch sinks refuse off-origin URLs', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('does not follow a feed rel="next" that leaves the provider host', async () => {
    const xml = `<?xml version="1.0"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <link rel="next" type="application/atom+xml" href="http://169.254.169.254/next"/>
</feed>`
    const fetchMock = vi.fn(
      async (_input: unknown, _init?: RequestInit) =>
        new Response(xml, { status: 200 }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMojAuthoritySummaries(
      { mojFindCaseLawBaseUrl: BASE },
      { query: 'example' },
      createMojRateLimiter(1000),
      { maxEntries: 10, maxPages: 10 },
    )

    expect(result.status).toBe('ok')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(String(fetchMock.mock.calls[0]?.[0])).not.toContain('169.254')
  })

  it('does not fetch off-origin stored source or xml URIs', async () => {
    const fetchMock = vi.fn(async () => new Response('<html></html>'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMojAuthorityDocumentFromRecord(
      { mojFindCaseLawBaseUrl: BASE },
      {
        summary: {
          id: 'uksc-2024-1',
          title: 'Example',
          neutralCitation: '[2024] UKSC 1',
          court: 'uksc',
          jurisdiction: 'england-and-wales',
          dateDecided: '2024-01-01',
          sourceType: 'judgment',
          sourceUrl: `${BASE}/uksc/2024/1`,
        } as never,
        provider: {
          documentUri: '/uksc/2024/1',
          sourceUri: 'http://169.254.169.254/stored.html',
          xmlUri: 'http://169.254.169.254/stored.xml',
          pdfUri: null,
          contentHash: 'hash',
          rawAtomEntry: '',
        },
      },
      createMojRateLimiter(1000),
    )

    expect(result.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not fetch an off-origin detail sourceUri', async () => {
    const fetchMock = vi.fn(async () => new Response('<html></html>'))
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMojAuthorityDetail(
      { mojFindCaseLawBaseUrl: BASE },
      entry({ sourceUri: 'http://169.254.169.254/secret' }),
      createMojRateLimiter(1000),
    )

    expect(result.status).toBe('skipped')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('does not follow a redirect that leaves the provider host', async () => {
    // A stub that would happily follow the redirect if the sink forgot
    // redirect: 'manual' — the exact regression this pins.
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      if (init?.redirect === 'manual') {
        return new Response(null, {
          status: 302,
          headers: { location: 'http://169.254.169.254/secret' },
        })
      }
      return new Response('<html>INTERNAL SECRET</html>', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const result = await fetchMojAuthorityDetail(
      { mojFindCaseLawBaseUrl: BASE },
      entry(),
      createMojRateLimiter(1000),
    )

    expect(result.status).toBe('skipped')
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(fetchMock.mock.calls[0]?.[1]?.redirect).toBe('manual')
  })
})
