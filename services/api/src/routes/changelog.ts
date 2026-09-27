import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { readBoundedResponseText } from '../bounded-upstream-body'

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
 * the refresh, so a rate limit cannot trigger the commits fallback. Regardless
 * of regime, every one of those requests draws on the same rolling
 * {@link CHANGELOG_REQUEST_BUDGET}, which is the route's hard ceiling.
 *
 * The bound is per API process, so N replicas multiply it N times, and any
 * other client sharing the egress IP also draws on GitHub's unauthenticated
 * allowance. No credential, shared cache or background polling is used.
 */

/** Fresh results are reused for ten minutes: about six refreshes an hour. */
export const CHANGELOG_FRESH_TTL_MS = 10 * 60_000

/** A failed refresh is not retried for two minutes: at most 30 an hour. */
export const CHANGELOG_FAILURE_COOLDOWN_MS = 2 * 60_000

/** Successfully fetched data is served for at most a day after a failure. */
export const CHANGELOG_STALE_MAX_MS = 24 * 60 * 60_000

/** Each upstream request is aborted after five seconds. */
export const CHANGELOG_UPSTREAM_TIMEOUT_MS = 5_000

/**
 * Hard per-process ceiling on upstream HTTP requests inside any rolling hour.
 * GitHub's unauthenticated allowance is 60 requests/hour/IP, so 30 leaves 2x
 * headroom for other replicas or clients sharing the egress IP. The budget is
 * spent per request, not per refresh, so successes, failures, the commits
 * fallback and throttled refreshes all draw on it.
 */
export const CHANGELOG_REQUEST_BUDGET = 30
export const CHANGELOG_REQUEST_WINDOW_MS = 60 * 60_000

/**
 * A throttled refresh waits at least a minute, GitHub's secondary-rate-limit
 * guidance. A valid provider delay can extend that; it can never shorten it.
 */
export const CHANGELOG_THROTTLE_MIN_COOLDOWN_MS = 60_000

/**
 * A provider delay beyond a day is treated as extreme and capped, so a
 * malformed or hostile header cannot park refreshes indefinitely. An hour is
 * far below this and is honoured as sent.
 */
export const CHANGELOG_COOLDOWN_MAX_MS = 24 * 60 * 60_000

/** A single upstream body is rejected, unparsed, once it passes this size. */
export const CHANGELOG_MAX_BODY_BYTES = 64 * 1024

/** GitHub's own per_page cap; a larger array is treated as malformed. */
export const CHANGELOG_MAX_ENTRIES = 5

const RELEASES_URL =
  'https://api.github.com/repos/ObiterDictum/obiter/releases?per_page=5'
const COMMITS_URL =
  'https://api.github.com/repos/ObiterDictum/obiter/commits?sha=dev&per_page=5'

/**
 * Release and commit bodies are untrusted, and `html_url` is rendered as an
 * anchor href. Restrict it to the GitHub origin: `z.string().url()` would also
 * accept `javascript:` and other unwanted schemes.
 */
function isGithubLink(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com'
  } catch {
    return false
  }
}

const githubLinkSchema = z
  .string()
  .max(2048)
  .refine(isGithubLink, 'must be an https://github.com link')

const githubReleaseSchema = z.object({
  html_url: githubLinkSchema,
  name: z.string().max(300).nullable(),
  published_at: z.string().max(40).nullable(),
  tag_name: z.string().max(300),
})

const githubCommitSchema = z.object({
  html_url: githubLinkSchema,
  sha: z.string().max(64),
  commit: z.object({
    message: z.string().max(4096),
    author: z.object({ date: z.string().max(40).optional() }).nullish(),
  }),
})

const releasesSchema = z.array(githubReleaseSchema).max(CHANGELOG_MAX_ENTRIES)
const commitsSchema = z.array(githubCommitSchema).max(CHANGELOG_MAX_ENTRIES)

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
  | { kind: 'throttled'; cooldownMs: number }
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

/** A positive, finite, capped delay, or null when the value is unusable. */
function boundedCooldown(ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.min(ms, CHANGELOG_COOLDOWN_MAX_MS)
}

/**
 * The cooldown a throttled response requires: the local throttle floor, or a
 * longer valid provider delay when one is present. `Retry-After` (seconds or
 * HTTP date) and `x-ratelimit-reset` (epoch seconds) are both considered, and
 * the longer valid instruction wins. Malformed, past, zero, negative and
 * non-finite values are ignored rather than allowed to shorten the floor,
 * retry immediately or overflow the clock.
 */
function throttleCooldownMs(response: Response, now: number): number {
  const requested: number[] = []
  const retryAfter = response.headers.get('retry-after')
  if (retryAfter !== null) {
    const seconds = Number(retryAfter)
    if (Number.isFinite(seconds)) {
      requested.push(seconds * 1000)
    } else {
      const at = Date.parse(retryAfter)
      if (Number.isFinite(at)) requested.push(at - now)
    }
  }
  const reset = response.headers.get('x-ratelimit-reset')
  if (reset !== null) {
    const seconds = Number(reset)
    if (Number.isFinite(seconds)) requested.push(seconds * 1000 - now)
  }

  const valid = requested
    .map(boundedCooldown)
    .filter((ms): ms is number => ms !== null)
  const provider = valid.length > 0 ? Math.max(...valid) : 0
  return Math.max(CHANGELOG_THROTTLE_MIN_COOLDOWN_MS, provider)
}

/**
 * Reads a response body up to a byte cap, then parses and validates it.
 * Returns null for an oversized, unreadable or invalid body.
 */
async function parseBoundedBody<T>(
  response: Response,
  schema: z.ZodType<T>,
): Promise<T | null> {
  const text = await readBoundedResponseText(response, CHANGELOG_MAX_BODY_BYTES)
  if (text === null) return null

  let body: unknown
  try {
    body = JSON.parse(text)
  } catch {
    return null
  }
  const parsed = schema.safeParse(body)
  return parsed.success ? parsed.data : null
}

async function requestUpstream<T>(
  url: string,
  schema: z.ZodType<T>,
  timeoutMs: number,
  now: () => number,
  reserve: () => boolean,
): Promise<UpstreamOutcome<T>> {
  // The budget is spent before the request is made, so an attempt that later
  // fails, is throttled, or triggers the commits fallback still counts.
  if (!reserve()) return { kind: 'unavailable' }

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
      cooldownMs: throttleCooldownMs(response, now()),
    }
  }
  if (!response.ok) return { kind: 'unavailable' }

  // Validate before anything is cached: a malformed or oversized body must not
  // replace a good cached result.
  const value = await parseBoundedBody(response, schema)
  if (value === null) return { kind: 'unavailable' }
  return { kind: 'ok', value }
}

async function refresh(
  timeoutMs: number,
  now: () => number,
  reserve: () => boolean,
): Promise<RefreshOutcome> {
  const releases = await requestUpstream(
    RELEASES_URL,
    releasesSchema,
    timeoutMs,
    now,
    reserve,
  )

  // A throttled releases response ends the refresh: calling commits next is
  // the fallback storm this route is bounded against.
  if (releases.kind === 'throttled') {
    return { kind: 'failed', cooldownMs: releases.cooldownMs }
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
    reserve,
  )
  if (commits.kind === 'throttled') {
    return { kind: 'failed', cooldownMs: commits.cooldownMs }
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
  // Upstream request timestamps inside the rolling budget window. The array is
  // bounded by CHANGELOG_REQUEST_BUDGET entries, so it cannot grow without
  // limit even under sustained failures or throttles.
  const requestTimes: number[] = []

  /**
   * Spends one slot of the rolling upstream-request budget. Every fetch goes
   * through here, so the ceiling holds across successes, failures, fallbacks
   * and throttling rather than only through the fresh-cache TTL.
   */
  const reserveUpstreamRequest = (): boolean => {
    const at = now()
    const cutoff = at - CHANGELOG_REQUEST_WINDOW_MS
    while (
      requestTimes.length > 0 &&
      (requestTimes[0] ?? Number.POSITIVE_INFINITY) <= cutoff
    ) {
      requestTimes.shift()
    }
    if (requestTimes.length >= CHANGELOG_REQUEST_BUDGET) return false
    requestTimes.push(at)
    return true
  }

  const startRefresh = (): Promise<RefreshOutcome> => {
    const running = refresh(timeoutMs, now, reserveUpstreamRequest).then(
      (outcome) => {
        if (outcome.kind === 'refreshed') {
          cached = { body: outcome.body, fetchedAt: now() }
        } else {
          cooldownUntil = Math.max(cooldownUntil, now() + outcome.cooldownMs)
        }
        return outcome
      },
    )
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
    // Stale data inside the window is returned byte-identical to a fresh hit:
    // `source` is unchanged, so consumers cannot tell the two apart. That is
    // the documented policy, not a bug. The boundary is inclusive: at exactly
    // CHANGELOG_STALE_MAX_MS the cached body is still served, and past it the
    // route answers 503.
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
