import { Hono, type Context } from 'hono'
import { z } from 'zod'

/**
 * Bounds the anonymous changelog route's GitHub traffic. The cache is a single
 * application-owned slot (the resource is fixed, so there is no key space to
 * evict), concurrent cold or expired callers share one refresh, a failure or
 * throttle sets a cooldown, each upstream request has a deadline, and a
 * validated body is served stale for at most {@link CHANGELOG_STALE_MAX_MS}
 * after a failure.
 *
 * At most two upstream requests are made per refresh: releases, then commits
 * only when releases is empty or unusable. A throttled releases response ends
 * the refresh, so a rate limit cannot trigger the commits fallback.
 *
 * The bound is per API process, so N replicas multiply it N times; it is not a
 * global quota. No credential, shared cache or background polling is used.
 */

/** Fresh results are reused for ten minutes: at most 12 refreshes an hour. */
export const CHANGELOG_FRESH_TTL_MS = 10 * 60_000

/** A failed refresh is not retried for two minutes: at most 30 an hour. */
export const CHANGELOG_FAILURE_COOLDOWN_MS = 2 * 60_000

/** Successfully fetched data is served for at most a day after a failure. */
export const CHANGELOG_STALE_MAX_MS = 24 * 60 * 60_000

/** Each upstream request is aborted after five seconds. */
export const CHANGELOG_UPSTREAM_TIMEOUT_MS = 5_000

const THROTTLE_COOLDOWN_MIN_MS = 1_000
const THROTTLE_COOLDOWN_MAX_MS = 15 * 60_000

const RELEASES_URL =
  'https://api.github.com/repos/ObiterDictum/obiter/releases?per_page=5'
const COMMITS_URL =
  'https://api.github.com/repos/ObiterDictum/obiter/commits?sha=dev&per_page=5'

const githubReleaseSchema = z.object({
  html_url: z.string(),
  name: z.string().nullable(),
  published_at: z.string().nullable(),
  tag_name: z.string(),
})

const githubCommitSchema = z.object({
  html_url: z.string(),
  sha: z.string(),
  commit: z.object({
    message: z.string(),
    author: z.object({ date: z.string().optional() }).nullish(),
  }),
})

const releasesSchema = z.array(githubReleaseSchema)
const commitsSchema = z.array(githubCommitSchema)

type ChangelogEntry = { date: string | null; title: string; url: string }
type ChangelogBody = {
  entries: ChangelogEntry[]
  source: 'github_releases' | 'github_commits' | 'github_unavailable'
}

type RefreshOutcome =
  | { kind: 'refreshed'; body: ChangelogBody }
  | { kind: 'failed'; cooldownMs: number }

type UpstreamOutcome<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'throttled'; retryDelayMs: number }
  | { kind: 'unavailable' }

const UNAVAILABLE_BODY: ChangelogBody = {
  entries: [],
  source: 'github_unavailable',
}

function releaseEntry(
  release: z.infer<typeof githubReleaseSchema>,
): ChangelogEntry {
  return {
    date: release.published_at?.slice(0, 10) ?? null,
    title: release.name ?? release.tag_name,
    url: release.html_url,
  }
}

function commitEntry(
  commit: z.infer<typeof githubCommitSchema>,
): ChangelogEntry {
  return {
    date: commit.commit.author?.date?.slice(0, 10) ?? null,
    title: commit.commit.message.split('\n')[0] ?? commit.sha.slice(0, 7),
    url: commit.html_url,
  }
}

/** 429, or 403 with the remaining counter at zero, is a spent rate limit. */
function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get('x-ratelimit-remaining') === '0')
  )
}

/** Clamp a header-derived delay, rejecting zeroes and non-finite values. */
function boundedThrottleDelay(ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.min(
    Math.max(ms, THROTTLE_COOLDOWN_MIN_MS),
    THROTTLE_COOLDOWN_MAX_MS,
  )
}

/**
 * The wait a throttled response asks for, from whichever header GitHub sent,
 * bounded so an absent or malformed value cannot retry immediately.
 */
function throttleDelayMs(response: Response, now: number): number | null {
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      const bounded = boundedThrottleDelay(seconds * 1000)
      if (bounded !== null) return bounded
    }
    const at = Date.parse(retryAfter)
    if (Number.isFinite(at)) {
      const bounded = boundedThrottleDelay(at - now)
      if (bounded !== null) return bounded
    }
  }

  const reset = response.headers.get('x-ratelimit-reset')
  if (reset !== null) {
    const seconds = Number(reset)
    if (Number.isFinite(seconds)) {
      const bounded = boundedThrottleDelay(seconds * 1000 - now)
      if (bounded !== null) return bounded
    }
  }

  return null
}

async function requestUpstream<T>(
  url: string,
  schema: z.ZodType<T>,
  timeoutMs: number,
  now: () => number,
): Promise<UpstreamOutcome<T>> {
  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'obiter-api',
      },
      // Aborts the response body too, so a stalled upstream cannot hold the
      // socket open past the deadline.
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    // A network failure and the deadline are both an unusable refresh.
    return { kind: 'unavailable' }
  }

  if (isRateLimited(response)) {
    return {
      kind: 'throttled',
      retryDelayMs:
        throttleDelayMs(response, now()) ?? CHANGELOG_FAILURE_COOLDOWN_MS,
    }
  }
  if (!response.ok) return { kind: 'unavailable' }

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return { kind: 'unavailable' }
  }

  // Validate before anything is cached: a malformed body must not replace a
  // good cached result.
  const parsed = schema.safeParse(body)
  if (!parsed.success) return { kind: 'unavailable' }
  return { kind: 'ok', value: parsed.data }
}

async function refresh(
  timeoutMs: number,
  now: () => number,
): Promise<RefreshOutcome> {
  const releases = await requestUpstream(
    RELEASES_URL,
    releasesSchema,
    timeoutMs,
    now,
  )

  // A throttled releases response ends the refresh: calling commits next is
  // the fallback storm this route is bounded against.
  if (releases.kind === 'throttled') {
    return { kind: 'failed', cooldownMs: releases.retryDelayMs }
  }
  if (releases.kind === 'ok' && releases.value.length > 0) {
    return {
      kind: 'refreshed',
      body: {
        entries: releases.value.map(releaseEntry),
        source: 'github_releases',
      },
    }
  }

  // Empty or unusable releases keep the established commits fallback.
  const commits = await requestUpstream(
    COMMITS_URL,
    commitsSchema,
    timeoutMs,
    now,
  )
  if (commits.kind === 'throttled') {
    return { kind: 'failed', cooldownMs: commits.retryDelayMs }
  }
  if (commits.kind === 'ok') {
    return {
      kind: 'refreshed',
      body: {
        entries: commits.value.map(commitEntry),
        source: 'github_commits',
      },
    }
  }

  return { kind: 'failed', cooldownMs: CHANGELOG_FAILURE_COOLDOWN_MS }
}

export interface ChangelogRouteOptions {
  /** Injectable clock, so tests can advance the fresh, cooldown and stale windows. */
  now?: () => number
  /** Upstream deadline override; defaults to {@link CHANGELOG_UPSTREAM_TIMEOUT_MS}. */
  upstreamTimeoutMs?: number
}

export function createChangelogRoutes(options: ChangelogRouteOptions = {}) {
  const now = options.now ?? Date.now
  const timeoutMs = options.upstreamTimeoutMs ?? CHANGELOG_UPSTREAM_TIMEOUT_MS
  const app = new Hono()

  let cached: { body: ChangelogBody; fetchedAt: number } | null = null
  let inFlight: Promise<RefreshOutcome> | null = null
  let cooldownUntil = 0

  const startRefresh = (): Promise<RefreshOutcome> => {
    const running = refresh(timeoutMs, now).then((outcome) => {
      if (outcome.kind === 'refreshed') {
        cached = { body: outcome.body, fetchedAt: now() }
      } else {
        cooldownUntil = Math.max(cooldownUntil, now() + outcome.cooldownMs)
      }
      return outcome
    })
    inFlight = running
    // Only one refresh can run at a time, because a new one starts only when
    // inFlight is clear, so clearing it here cannot clear a newer refresh.
    const clear = () => {
      inFlight = null
    }
    void running.then(clear, clear)
    return running
  }

  const respondFromCache = (c: Context) => {
    if (cached && now() - cached.fetchedAt <= CHANGELOG_STALE_MAX_MS) {
      return c.json(cached.body)
    }
    return c.json(UNAVAILABLE_BODY, 503)
  }

  app.get('/api/changelog', async (c) => {
    const at = now()
    if (cached && at - cached.fetchedAt < CHANGELOG_FRESH_TTL_MS) {
      return c.json(cached.body)
    }
    if (at < cooldownUntil) {
      return respondFromCache(c)
    }

    const outcome = await (inFlight ?? startRefresh())
    if (outcome.kind === 'refreshed') return c.json(outcome.body)
    return respondFromCache(c)
  })

  return app
}
