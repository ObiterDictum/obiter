import { afterEach, describe, expect, it } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import { createChangelogRoutes } from './changelog'

/**
 * The route is anonymous, so its upstream traffic bound has to hold under
 * repeated, concurrent and failing requests. Every test drives the real route
 * with a mocked GitHub boundary and a controllable clock; none of them touch
 * the network.
 *
 * The documented policy these tests hold to: 10-minute fresh interval,
 * 2-minute failure cooldown, stale data served for at most 24 hours, 5-second
 * upstream deadline. Tests use concrete windows rather than importing the
 * constants so a policy change has to be made deliberately, here as well.
 */

const release = {
  html_url: 'https://github.com/ObiterDictum/obiter/releases/tag/v1',
  name: 'Initial search release',
  published_at: '2026-05-22T10:00:00Z',
  tag_name: 'v1',
}
const releaseEntry = {
  date: '2026-05-22',
  title: 'Initial search release',
  url: 'https://github.com/ObiterDictum/obiter/releases/tag/v1',
}

const commit = {
  html_url: 'https://github.com/ObiterDictum/obiter/commit/abc1234',
  sha: 'abc1234567890',
  commit: {
    message: 'Cache the public changelog\n\nExplains why.',
    author: { date: '2026-06-01T09:00:00Z' },
  },
}
const commitEntry = {
  date: '2026-06-01',
  title: 'Cache the public changelog',
  url: 'https://github.com/ObiterDictum/obiter/commit/abc1234',
}

const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init })

function clockFrom(start: number) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

function githubFetch(
  releases: (init?: RequestInit) => Promise<Response>,
  commits: (init?: RequestInit) => Promise<Response>,
) {
  return vi.fn(async (input: string | URL, init?: RequestInit) =>
    String(input).includes('/releases') ? releases(init) : commits(init),
  )
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/changelog upstream bounds', () => {
  it('serves a fresh cache hit without another upstream request', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([release]),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const first = await app.request('/api/changelog')
    expect(await first.json()).toEqual({
      entries: [releaseEntry],
      source: 'github_releases',
    })

    clock.advance(60_000)
    const second = await app.request('/api/changelog')
    expect(second.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one refresh across concurrent cold callers', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([release]),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/api/changelog')),
    )

    expect(responses.map((response) => response.status)).toEqual([
      200, 200, 200, 200, 200,
    ])
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('shares one refresh across concurrent callers after expiry', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([release]),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    await app.request('/api/changelog')
    // Past the 10-minute fresh interval, so every caller wants a refresh.
    clock.advance(11 * 60_000)
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => app.request('/api/changelog')),
    )

    expect(responses.every((response) => response.status === 200)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('falls back to commits when releases is empty', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([]),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const response = await app.request('/api/changelog')

    expect(await response.json()).toEqual({
      entries: [commitEntry],
      source: 'github_commits',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('does not call commits when releases is rate limited', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '30' },
        }),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const first = await app.request('/api/changelog')
    expect(first.status).toBe(503)

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await app.request('/api/changelog')
    }
    // One throttled releases attempt, and no fallback storm behind it.
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The retry-after delay is honoured with a bounded wait, not immediately.
    clock.advance(31_000)
    await app.request('/api/changelog')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('treats a 403 rate limit as throttling and respects the reset header', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () =>
        new Response('rate limited', {
          status: 403,
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': '1020',
          },
        }),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const first = await app.request('/api/changelog')
    expect(first.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(1)

    // The reset is 20 seconds away; a request before then must not retry.
    clock.advance(19_000)
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    clock.advance(2_000)
    await app.request('/api/changelog')
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1)
  })

  it('falls through to commits on a plain permission failure', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => new Response('forbidden', { status: 403 }),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const response = await app.request('/api/changelog')

    expect(await response.json()).toEqual({
      entries: [commitEntry],
      source: 'github_commits',
    })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('applies a failure cooldown so repeated failures do not amplify', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => new Response('down', { status: 502 }),
      async () => new Response('down', { status: 502 }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await app.request('/api/changelog')
      expect(response.status).toBe(503)
    }
    // One refresh: a releases attempt and its commits fallback.
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // Past the 2-minute failure cooldown a new refresh is allowed, once.
    clock.advance(3 * 60_000)
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  it('rejects a malformed releases body and falls back safely', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json(null),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const first = await app.request('/api/changelog')
    expect(first.status).toBe(200)
    expect(await first.json()).toEqual({
      entries: [commitEntry],
      source: 'github_commits',
    })

    // The good commits result is cached; the malformed releases body is not.
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('rejects releases entries missing required fields', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([{ tag_name: 'v1' }]),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const response = await app.request('/api/changelog')

    expect(await response.json()).toEqual({
      entries: [commitEntry],
      source: 'github_commits',
    })
  })

  it('rejects a malformed commits body without caching it', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([]),
      async () => json({ commits: 'nope' }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const first = await app.request('/api/changelog')
    expect(first.status).toBe(503)
    expect(await first.json()).toEqual({
      entries: [],
      source: 'github_unavailable',
    })

    // The failure cooldown holds the second request off upstream entirely.
    const second = await app.request('/api/changelog')
    expect(second.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('serves an empty commits result as github_commits', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = githubFetch(
      async () => json([]),
      async () => json([]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const response = await app.request('/api/changelog')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({
      entries: [],
      source: 'github_commits',
    })
  })

  it('serves stale data during a failure within the stale window', async () => {
    const clock = clockFrom(1_000_000)
    let failing = false
    const fetchMock = githubFetch(
      async () =>
        failing ? new Response('down', { status: 502 }) : json([release]),
      async () => (failing ? new Response('down', { status: 502 }) : json([])),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    await app.request('/api/changelog')
    // Past the fresh interval but well inside the 24-hour stale window.
    clock.advance(11 * 60_000)
    failing = true

    const stale = await app.request('/api/changelog')
    expect(stale.status).toBe(200)
    expect(await stale.json()).toEqual({
      entries: [releaseEntry],
      source: 'github_releases',
    })
  })

  it('returns github_unavailable once stale data is past the stale window', async () => {
    const clock = clockFrom(1_000_000)
    let failing = false
    const fetchMock = githubFetch(
      async () =>
        failing ? new Response('down', { status: 502 }) : json([release]),
      async () => (failing ? new Response('down', { status: 502 }) : json([])),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    await app.request('/api/changelog')
    // Past the 24-hour stale cap, so stale data is no longer served silently.
    clock.advance(25 * 60 * 60_000)
    failing = true

    const response = await app.request('/api/changelog')
    expect(response.status).toBe(503)
    expect(await response.json()).toEqual({
      entries: [],
      source: 'github_unavailable',
    })
  })

  it('releases in-flight state after an upstream timeout', async () => {
    const clock = clockFrom(1_000_000)
    const fetchMock = vi.fn(
      (_input: string | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new Error('upstream deadline exceeded')),
          )
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now, upstreamTimeoutMs: 5 })

    let slowTimer: ReturnType<typeof setTimeout> | undefined
    const first = await Promise.race([
      app.request('/api/changelog'),
      new Promise<null>((resolve) => {
        slowTimer = setTimeout(() => resolve(null), 200)
      }),
    ])
    clearTimeout(slowTimer)
    expect(first).not.toBeNull()
    expect(first?.status).toBe(503)

    // A timed-out refresh must not wedge the single-flight slot.
    clock.advance(3 * 60_000)
    const second = await app.request('/api/changelog')
    expect(second.status).toBe(503)
    expect(fetchMock.mock.calls.length).toBeGreaterThan(2)
  })
})
