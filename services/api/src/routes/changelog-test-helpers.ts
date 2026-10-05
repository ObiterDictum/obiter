import { vi } from '../../../../scripts/test/vitest-compat'

/**
 * Shared fixtures and boundary helpers for the changelog route suites. The
 * route is anonymous, so its traffic bound is proved with a mocked GitHub
 * boundary and a controllable clock; no helper touches the network.
 */

export const START = 1_000_000

export const release = {
  html_url: 'https://github.com/ObiterDictum/obiter/releases/tag/v1',
  name: 'Initial search release',
  published_at: '2026-05-22T10:00:00Z',
  tag_name: 'v1',
}
export const releaseEntry = {
  date: '2026-05-22',
  title: 'Initial search release',
  url: 'https://github.com/ObiterDictum/obiter/releases/tag/v1',
}

export const commit = {
  html_url: 'https://github.com/ObiterDictum/obiter/commit/abc1234',
  sha: 'abc1234567890',
  commit: {
    message: 'Cache the public changelog\n\nExplains why.',
    author: { date: '2026-06-01T09:00:00Z' },
  },
}
export const commitEntry = {
  date: '2026-06-01',
  title: 'Cache the public changelog',
  url: 'https://github.com/ObiterDictum/obiter/commit/abc1234',
}

export const json = (body: unknown, init?: ResponseInit) =>
  new Response(JSON.stringify(body), { status: 200, ...init })

export function clockFrom(start: number) {
  let current = start
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms
    },
  }
}

export function githubFetch(
  releases: (init?: RequestInit) => Promise<Response>,
  commits: (init?: RequestInit) => Promise<Response>,
) {
  return vi.fn(async (input: string | URL, init?: RequestInit) =>
    String(input).includes('/releases') ? releases(init) : commits(init),
  )
}
