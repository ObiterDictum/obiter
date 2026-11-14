import { describe, expect, it } from 'bun:test'
import {
  BUILD_POLL_INTERVAL_MS,
  BUILD_VERSION_PATH,
  fetchServedBuild,
  watchServedBuild,
  type BuildWatchTarget,
} from './build-version'

function fakeTab(visibility: 'visible' | 'hidden' = 'visible') {
  const intervals = new Map<number, { fn: () => void; ms: number }>()
  const listeners = new Map<string, Set<() => void>>()
  const focusListeners = {
    get size() {
      return [...listeners.values()].reduce((sum, set) => sum + set.size, 0)
    },
  }
  let nextId = 1
  const target: BuildWatchTarget = {
    document: { visibilityState: visibility },
    setInterval: (fn, ms) => {
      const id = nextId++
      intervals.set(id, { fn, ms })
      return id
    },
    clearInterval: (id) => {
      intervals.delete(id)
    },
    addEventListener: (type, listener) => {
      const set = listeners.get(type) ?? new Set()
      set.add(listener)
      listeners.set(type, set)
    },
    removeEventListener: (type, listener) => {
      listeners.get(type)?.delete(listener)
    },
  }
  return {
    target,
    setVisibility(next: 'visible' | 'hidden') {
      target.document = { visibilityState: next }
    },
    tick() {
      for (const { fn } of intervals.values()) fn()
    },
    fire(type: string) {
      for (const listener of listeners.get(type) ?? []) listener()
    },
    focus() {
      for (const listener of listeners.get('focus') ?? []) listener()
    },
    intervals,
    focusListeners,
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

function servedBuilds(...builds: (string | null)[]) {
  const calls: number[] = []
  const fetchBuild = async () => {
    calls.push(calls.length)
    return builds[Math.min(calls.length - 1, builds.length - 1)] ?? null
  }
  return { fetchBuild, calls }
}

describe('watchServedBuild', () => {
  it('polls every minute', () => {
    const tab = fakeTab()
    const stop = watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: () => {},
      fetchBuild: async () => 'a',
      target: tab.target,
    })
    expect([...tab.intervals.values()].map((entry) => entry.ms)).toEqual([
      BUILD_POLL_INTERVAL_MS,
    ])
    expect(BUILD_POLL_INTERVAL_MS).toBe(60 * 1000)
    stop()
  })

  it('asks the server on each poll while the tab is visible', async () => {
    const tab = fakeTab('visible')
    const served = servedBuilds('a')
    watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: () => {},
      fetchBuild: served.fetchBuild,
      target: tab.target,
    })
    tab.tick()
    tab.tick()
    await settle()
    expect(served.calls).toHaveLength(2)
  })

  it('does not ask the server while the tab is hidden', async () => {
    const tab = fakeTab('hidden')
    const served = servedBuilds('b')
    const seen: string[] = []
    watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: (build) => seen.push(build),
      fetchBuild: served.fetchBuild,
      target: tab.target,
    })
    tab.tick()
    await settle()
    expect(served.calls).toHaveLength(0)
    expect(seen).toEqual([])
  })

  it('checks when the tab regains focus', async () => {
    const tab = fakeTab('hidden')
    const served = servedBuilds('b')
    const seen: string[] = []
    watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: (build) => seen.push(build),
      fetchBuild: served.fetchBuild,
      target: tab.target,
    })
    tab.setVisibility('visible')
    tab.focus()
    await settle()
    expect(seen).toEqual(['b'])
  })

  for (const event of ['visibilitychange', 'online']) {
    it(`checks straight away on ${event}, without waiting for the next poll`, async () => {
      const tab = fakeTab('hidden')
      const served = servedBuilds('b')
      const seen: string[] = []
      watchServedBuild({
        loadedBuild: 'a',
        onNewBuild: (build) => seen.push(build),
        fetchBuild: served.fetchBuild,
        target: tab.target,
      })
      tab.setVisibility('visible')
      tab.fire(event)
      await settle()
      expect(seen).toEqual(['b'])
    })
  }

  it('stays quiet while the served build is the one the page loaded', async () => {
    const tab = fakeTab()
    const seen: string[] = []
    watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: (build) => seen.push(build),
      fetchBuild: async () => 'a',
      target: tab.target,
    })
    tab.tick()
    tab.focus()
    await settle()
    expect(seen).toEqual([])
  })

  it('reports a different served build once and then stops polling', async () => {
    const tab = fakeTab()
    const seen: string[] = []
    watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: (build) => seen.push(build),
      fetchBuild: async () => 'b',
      target: tab.target,
    })
    tab.tick()
    tab.focus()
    await settle()
    expect(seen).toEqual(['b'])
    expect(tab.intervals.size).toBe(0)
    expect(tab.focusListeners.size).toBe(0)
  })

  it('stays silent when the server cannot be reached', async () => {
    const tab = fakeTab()
    const seen: string[] = []
    watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: (build) => seen.push(build),
      fetchBuild: () =>
        fetchServedBuild(() => Promise.reject(new TypeError('offline'))),
      target: tab.target,
    })
    tab.tick()
    await settle()
    expect(seen).toEqual([])
    expect(tab.intervals.size).toBe(1)
  })

  it('stops listening when the page unmounts the watcher', () => {
    const tab = fakeTab()
    const stop = watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: () => {},
      fetchBuild: async () => 'a',
      target: tab.target,
    })
    stop()
    expect(tab.intervals.size).toBe(0)
    expect(tab.focusListeners.size).toBe(0)
  })

  it('never reports a build that arrives after the watcher stopped', async () => {
    const tab = fakeTab()
    const seen: string[] = []
    const stop = watchServedBuild({
      loadedBuild: 'a',
      onNewBuild: (build) => seen.push(build),
      fetchBuild: async () => 'b',
      target: tab.target,
    })
    tab.tick()
    stop()
    await settle()
    expect(seen).toEqual([])
  })
})

describe('fetchServedBuild', () => {
  it('reads the build id from the uncached version route', async () => {
    const requests: { url: string; init?: RequestInit }[] = []
    const build = await fetchServedBuild(async (url, init) => {
      requests.push({ url: String(url), init })
      return Response.json({ build: 'abc1234' })
    })
    expect(build).toBe('abc1234')
    expect(requests).toEqual([
      { url: BUILD_VERSION_PATH, init: { cache: 'no-store' } },
    ])
  })

  it('treats an error status as no answer', async () => {
    const build = await fetchServedBuild(
      async () => new Response('not found', { status: 404 }),
    )
    expect(build).toBeNull()
  })

  it('treats a body without a build id as no answer', async () => {
    expect(
      await fetchServedBuild(async () => Response.json({ build: 7 })),
    ).toBeNull()
    expect(
      await fetchServedBuild(async () => new Response('<!doctype html>')),
    ).toBeNull()
  })

  it('treats a network failure as no answer', async () => {
    const build = await fetchServedBuild(() =>
      Promise.reject(new TypeError('Failed to fetch')),
    )
    expect(build).toBeNull()
  })
})
