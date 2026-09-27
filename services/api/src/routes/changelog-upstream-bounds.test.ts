import { afterEach, describe, expect, it } from 'bun:test'
import { createServer, type Server } from 'node:http'
import { vi } from '../../../../scripts/test/vitest-compat'
import { createChangelogRoutes } from './changelog'
import {
  START,
  clockFrom,
  commit,
  commitEntry,
  githubFetch,
  json,
  release,
} from './changelog-test-helpers'

/**
 * Throttle scheduling, the rolling upstream-request budget, body and entry
 * caps, link validation and the real-socket deadline. Every test drives the
 * real route with a mocked GitHub boundary and a controllable clock, except
 * the last, which uses a task-owned local server. None touch GitHub.
 *
 * The documented policy these tests hold to: a 60-second minimum throttle
 * cooldown that a provider delay can only extend (up to a 24-hour cap), 30
 * upstream requests per rolling hour across every regime, and a 64 KiB body
 * cap with entry and field limits. Tests use concrete windows rather than
 * importing the constants so a policy change has to be made deliberately,
 * here as well. Cache, failure and stale behavior live in changelog.test.ts.
 */

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('GET /api/changelog throttle, budget and payload bounds', () => {
  interface ThrottleHarness {
    clock: ReturnType<typeof clockFrom>
    app: ReturnType<typeof createChangelogRoutes>
    fetchMock: ReturnType<typeof githubFetch>
  }

  async function throttledReleases(
    headers: Record<string, string>,
  ): Promise<ThrottleHarness> {
    const clock = clockFrom(START)
    const fetchMock = githubFetch(
      async () => new Response('rate limited', { status: 429, headers }),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })
    const response = await app.request('/api/changelog')
    expect(response.status).toBe(503)
    return { clock, app, fetchMock }
  }

  async function retriedAfter(
    harness: ThrottleHarness,
    ms: number,
  ): Promise<boolean> {
    const before = harness.fetchMock.mock.calls.length
    harness.clock.advance(ms)
    await harness.app.request('/api/changelog')
    return harness.fetchMock.mock.calls.length > before
  }

  const floorCases: Array<[string, Record<string, string>]> = [
    ['a short Retry-After of one second', { 'retry-after': '1' }],
    ['a malformed Retry-After', { 'retry-after': 'soon' }],
    ['a negative Retry-After', { 'retry-after': '-30' }],
    ['a zero Retry-After', { 'retry-after': '0' }],
    ['a fractional Retry-After', { 'retry-after': '1.5' }],
    ['an infinite Retry-After', { 'retry-after': '1e400' }],
  ]

  for (const [label, headers] of floorCases) {
    it(`holds the 60-second floor for ${label}`, async () => {
      const harness = await throttledReleases(headers)
      expect(harness.fetchMock).toHaveBeenCalledTimes(1)

      // 59 seconds is still inside the floor; the next second retries.
      expect(await retriedAfter(harness, 59_000)).toBe(false)
      expect(await retriedAfter(harness, 1_000)).toBe(true)
    })
  }

  it('honours an HTTP-date Retry-After ten minutes out', async () => {
    const harness = await throttledReleases({
      'retry-after': new Date(START + 10 * 60_000).toUTCString(),
    })
    expect(await retriedAfter(harness, 599_000)).toBe(false)
    expect(await retriedAfter(harness, 1_000)).toBe(true)
  })

  it('honours a one-hour provider delay instead of clamping it to 15 minutes', async () => {
    const harness = await throttledReleases({ 'retry-after': '3600' })
    expect(await retriedAfter(harness, 15 * 60_000 + 1_000)).toBe(false)
    expect(await retriedAfter(harness, 45 * 60_000 - 2_000)).toBe(false)
    expect(await retriedAfter(harness, 1_000)).toBe(true)
  })

  it('caps an extreme provider delay at 24 hours rather than overflowing', async () => {
    const harness = await throttledReleases({ 'retry-after': '31536000' })
    expect(await retriedAfter(harness, 24 * 60 * 60_000 - 1_000)).toBe(false)
    expect(await retriedAfter(harness, 1_000)).toBe(true)
  })

  it('falls back to x-ratelimit-reset when Retry-After is malformed', async () => {
    const harness = await throttledReleases({
      'retry-after': 'soon',
      'x-ratelimit-reset': String(START / 1000 + 120),
    })
    expect(await retriedAfter(harness, 119_000)).toBe(false)
    expect(await retriedAfter(harness, 1_000)).toBe(true)
  })

  it('counts both requests when empty releases is followed by throttled commits', async () => {
    const clock = clockFrom(START)
    const fetchMock = githubFetch(
      async () => json([]),
      async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '1' },
        }),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const first = await app.request('/api/changelog')
    expect(first.status).toBe(503)
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // The one-second provider delay does not shorten the local floor.
    clock.advance(59_000)
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(2)

    // One retry after the floor, which makes two more requests.
    clock.advance(1_000)
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(4)
  })

  async function fillThrottledBudget() {
    const clock = clockFrom(0)
    const fetchMock = githubFetch(
      async () =>
        new Response('rate limited', {
          status: 429,
          headers: { 'retry-after': '60' },
        }),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })
    for (let request = 0; request < 30; request += 1) {
      await app.request('/api/changelog')
      clock.advance(60_000)
    }
    return { clock, fetchMock, app }
  }

  it('admits one more request exactly when the oldest leaves the rolling hour', async () => {
    const { clock, fetchMock, app } = await fillThrottledBudget()
    expect(fetchMock).toHaveBeenCalledTimes(30)

    // Still inside the window: the 31st request is denied without a fetch.
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(30)

    // Exactly one hour after the first request its slot is free again.
    clock.advance(30 * 60_000)
    await app.request('/api/changelog')
    expect(fetchMock).toHaveBeenCalledTimes(31)
  })

  it('does not let concurrent callers exceed the rolling request budget', async () => {
    const { clock, fetchMock, app } = await fillThrottledBudget()

    // The cooldown has cleared but the window is full, so every concurrent
    // caller shares one denied refresh and no upstream request is made.
    clock.advance(0)
    const responses = await Promise.all(
      Array.from({ length: 8 }, () => app.request('/api/changelog')),
    )
    expect(responses.every((response) => response.status === 503)).toBe(true)
    expect(fetchMock).toHaveBeenCalledTimes(30)
  })

  it('rejects an oversized streamed body and cancels it before parsing', async () => {
    const clock = clockFrom(START)
    let cancelled = false
    let streamed = 0
    let remaining = 40 // 640 KiB, comfortably past the 64 KiB cap.
    const oversized = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (remaining <= 0) {
          controller.close()
          return
        }
        remaining -= 1
        streamed += 16 * 1024
        controller.enqueue(new Uint8Array(16 * 1024).fill(0x61))
      },
      cancel() {
        cancelled = true
      },
    })
    const fetchMock = githubFetch(
      async () => new Response(oversized),
      async () => json([commit]),
    )
    vi.stubGlobal('fetch', fetchMock)
    const app = createChangelogRoutes({ now: clock.now })

    const response = await app.request('/api/changelog')

    // The oversized releases body is dropped and the commits fallback runs.
    expect(await response.json()).toEqual({
      entries: [commitEntry],
      source: 'github_commits',
    })
    // The stream is cancelled, which is the cap firing. The exact number of
    // chunks read ahead is runtime-dependent; the point is that it never
    // consumed the whole body.
    expect(cancelled).toBe(true)
    expect(streamed).toBeLessThanOrEqual(16 * 16 * 1024)
  })

  it('rejects a releases array larger than the entry cap', async () => {
    const clock = clockFrom(START)
    const fetchMock = githubFetch(
      async () => json(Array.from({ length: 6 }, () => release)),
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

  it('rejects a release field past its size cap', async () => {
    const clock = clockFrom(START)
    const fetchMock = githubFetch(
      async () => json([{ ...release, name: 'a'.repeat(301) }]),
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

  const badLinks: Array<[string, string]> = [
    ['a javascript scheme', 'javascript:alert(1)'],
    ['an http scheme', 'http://github.com/ObiterDictum/obiter/releases/tag/v1'],
    ['a foreign origin', 'https://evil.example/obiter/releases/tag/v1'],
    ['a prefix-spoofed origin', 'https://github.com.evil.example/obiter'],
    ['a bare string', 'not-a-url'],
  ]

  for (const [label, url] of badLinks) {
    it(`rejects a release link with ${label}`, async () => {
      const clock = clockFrom(START)
      const fetchMock = githubFetch(
        async () => json([{ ...release, html_url: url }]),
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
  }

  it('aborts a stalled upstream body at the deadline over a real socket', async () => {
    const clock = clockFrom(START)
    const realFetch = globalThis.fetch
    let stalled = 0
    const server: Server = createServer((_request, response) => {
      stalled += 1
      response.writeHead(200, { 'content-type': 'application/json' })
      // Headers and a partial body, then never finish. Without an abort this
      // hangs forever; the route's deadline must cover body consumption.
      response.write('[')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    const port = typeof address === 'object' && address ? address.port : 0
    vi.stubGlobal('fetch', (input: string | URL, init?: RequestInit) =>
      realFetch(`http://127.0.0.1:${port}/stall`, init),
    )
    const app = createChangelogRoutes({
      now: clock.now,
      upstreamTimeoutMs: 500,
    })

    let guard: ReturnType<typeof setTimeout> | undefined
    try {
      const started = Date.now()
      const response = await Promise.race([
        app.request('/api/changelog'),
        new Promise<never>((_resolve, reject) => {
          guard = setTimeout(
            () => reject(new Error('upstream deadline was not enforced')),
            4_000,
          )
        }),
      ])
      clearTimeout(guard)
      expect(response.status).toBe(503)
      // Two sequential 500 ms deadlines (releases, then commits).
      expect(Date.now() - started).toBeLessThan(3_000)
      expect(stalled).toBeGreaterThanOrEqual(1)
    } finally {
      const closable = server as Server & { closeAllConnections?: () => void }
      closable.closeAllConnections?.()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
