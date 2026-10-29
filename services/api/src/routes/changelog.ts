import { Hono, type Context } from 'hono'
import { z } from 'zod'
import { readBoundedResponseText } from '../bounded-upstream-body'

const CHANGELOG_FRESH_TTL_MS = 10 * 60_000

const CHANGELOG_FAILURE_COOLDOWN_MS = 2 * 60_000

const CHANGELOG_STALE_MAX_MS = 24 * 60 * 60_000

const CHANGELOG_UPSTREAM_TIMEOUT_MS = 5_000

const CHANGELOG_REQUEST_BUDGET = 30
const CHANGELOG_REQUEST_WINDOW_MS = 60 * 60_000

const CHANGELOG_THROTTLE_MIN_COOLDOWN_MS = 60_000

const CHANGELOG_COOLDOWN_MAX_MS = 24 * 60 * 60_000

const CHANGELOG_MAX_BODY_BYTES = 64 * 1024

const CHANGELOG_MAX_ENTRIES = 5

const RELEASES_URL =
  'https://api.github.com/repos/ObiterDictum/obiter/releases?per_page=5'
const COMMITS_URL =
  'https://api.github.com/repos/ObiterDictum/obiter/commits?sha=dev&per_page=5'

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

function isRateLimited(response: Response): boolean {
  return (
    response.status === 429 ||
    (response.status === 403 &&
      response.headers.get('x-ratelimit-remaining') === '0')
  )
}

function boundedCooldown(ms: number): number | null {
  if (!Number.isFinite(ms) || ms <= 0) return null
  return Math.min(ms, CHANGELOG_COOLDOWN_MAX_MS)
}

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
  if (!reserve()) return { kind: 'unavailable' }

  let response: Response
  try {
    response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'obiter-api',
      },
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch {
    return { kind: 'unavailable' }
  }

  if (isRateLimited(response)) {
    return {
      kind: 'throttled',
      cooldownMs: throttleCooldownMs(response, now()),
    }
  }
  if (!response.ok) return { kind: 'unavailable' }

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
  now?: () => number
  upstreamTimeoutMs?: number
}

export function createChangelogRoutes(options: ChangelogRouteOptions = {}) {
  const now = options.now ?? Date.now
  const timeoutMs = options.upstreamTimeoutMs ?? CHANGELOG_UPSTREAM_TIMEOUT_MS
  const app = new Hono()

  let cached: { body: ChangelogBody; fetchedAt: number } | null = null
  let inFlight: Promise<RefreshOutcome> | null = null
  let cooldownUntil = 0
  const requestTimes: number[] = []

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
