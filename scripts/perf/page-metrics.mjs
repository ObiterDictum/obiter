/*
 * Browser-side measurement primitives for the page-load runner: the init
 * script that installs the performance observers, the two route-ready
 * milestones, resource collection, password sign-in, and port waiting.
 *
 * These are pure browser interactions with explicit parameters, kept out of the
 * runner so they can be read and reasoned about without the orchestration and
 * reporting code around them. `net` and Playwright's `chromium` are the only
 * dependencies.
 */
import net from 'node:net'

export const NETWORK_PROFILES = {
  fast3g: {
    offline: false,
    latency: 150,
    downloadThroughput: (1.6 * 1024 * 1024) / 8,
    uploadThroughput: (750 * 1024) / 8,
  },
  slow4g: {
    offline: false,
    latency: 100,
    downloadThroughput: (4 * 1024 * 1024) / 8,
    uploadThroughput: (3 * 1024 * 1024) / 8,
  },
}

/** Installed in every page before any script: CLS, long tasks and LCP. */
export const COLLECT_INIT_SCRIPT = () => {
  window.__perf = { cls: 0, longTasks: [], lcp: 0 }
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (!e.hadRecentInput) window.__perf.cls += e.value
      }
    }).observe({ type: 'layout-shift', buffered: true })
    new PerformanceObserver((list) => {
      for (const e of list.getEntries())
        window.__perf.longTasks.push(e.duration)
    }).observe({ type: 'longtask', buffered: true })
    new PerformanceObserver((list) => {
      const entries = list.getEntries()
      const last = entries[entries.length - 1]
      if (last) window.__perf.lcp = last.startTime
    }).observe({ type: 'largest-contentful-paint', buffered: true })
  } catch {
    // A browser without a given observer type still yields the rest.
  }
}

/**
 * Two milestones for one navigation:
 *   contentMs — the primary control for this route is present and enabled. A
 *               skeleton alone does not count.
 *   readyMs   — the same control, after React has hydrated the document. The
 *               hydration marker is used rather than the `load` event, because
 *               the client entry is an async module script and `load` can fire
 *               while it is still in flight. The control is interactive by
 *               this point, not merely painted.
 * Both are measured from navigation start via performance.now().
 */
export async function milestones(page, selector) {
  const content = await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      if (!el || el.disabled === true) return false
      return performance.now()
    },
    selector,
    { timeout: 45_000 },
  )
  const contentMs = await content.jsonValue()
  const ready = await page.waitForFunction(
    (sel) => {
      const el = document.querySelector(sel)
      if (!el || el.disabled === true) return false
      // hydrateRoot marks its container with a React fiber/props key.
      const hydrated =
        Object.keys(document.body).some((k) => k.startsWith('__react')) ||
        Object.keys(document.documentElement).some((k) =>
          k.startsWith('__react'),
        )
      return hydrated ? performance.now() : false
    },
    selector,
    { timeout: 45_000 },
  )
  const readyMs = await ready.jsonValue()
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  )
  return { contentMs, readyMs }
}

/**
 * Read the metrics for the navigation just finished. `sinceMs` scopes the
 * resource list to work done after a client-side navigation started; without
 * it a client-navigation sample would report the initial document's payload.
 */
export async function collect(page, contentMs, readyMs, sinceMs) {
  return page.evaluate(
    ({ content, ready, since }) => {
      const nav = performance.getEntriesByType('navigation')[0]
      const resources = performance
        .getEntriesByType('resource')
        .filter((e) => e.startTime >= since)
      const sum = (list, key) => list.reduce((a, e) => a + (e[key] || 0), 0)
      // Module scripts and modulepreload requests report initiatorType
      // 'other', so classify by extension rather than by that field.
      const byExtension = (suffixes) =>
        resources.filter((e) =>
          suffixes.some((s) => new URL(e.name).pathname.endsWith(s)),
        )
      const scripts = byExtension(['.js', '.mjs'])
      const styles = byExtension(['.css'])
      const fonts = byExtension(['.woff', '.woff2'])
      const api = resources.filter((e) => e.name.includes('/api/'))
      const longTasks = window.__perf.longTasks
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]
      return {
        contentMs: Math.round(content),
        readyMs: Math.round(ready),
        finalPath: location.pathname,
        ttfbMs: Math.round(nav.responseStart),
        domContentLoadedMs: Math.round(nav.domContentLoadedEventEnd),
        loadMs: Math.round(nav.loadEventEnd),
        fcpMs: fcp ? Math.round(fcp.startTime) : null,
        lcpMs: Math.round(window.__perf.lcp) || null,
        cls: Number(window.__perf.cls.toFixed(4)),
        longTaskCount: longTasks.length,
        longTaskTotalMs: Math.round(longTasks.reduce((a, d) => a + d, 0)),
        totalBlockingMs: Math.round(
          longTasks.reduce((a, d) => a + Math.max(0, d - 50), 0),
        ),
        resourceCount: resources.length,
        scriptCount: scripts.length,
        scriptTransferBytes: sum(scripts, 'transferSize'),
        scriptDecodedBytes: sum(scripts, 'decodedBodySize'),
        styleCount: styles.length,
        styleTransferBytes: sum(styles, 'transferSize'),
        fontCount: fonts.length,
        fontTransferBytes: sum(fonts, 'transferSize'),
        totalTransferBytes: sum(resources, 'transferSize'),
        largestScripts: scripts
          .map((e) => ({
            name: e.name.split('/').pop(),
            transferBytes: e.transferSize,
            decodedBytes: e.decodedBodySize,
          }))
          .sort((a, b) => b.decodedBytes - a.decodedBytes)
          .slice(0, 6),
        apiRequests: api.map((e) => ({
          path: new URL(e.name).pathname,
          durationMs: Math.round(e.duration),
          transferBytes: e.transferSize,
        })),
      }
    },
    { content: contentMs, ready: readyMs, since: sinceMs },
  )
}

/**
 * Password sign-in. Credentials arrive as parameters and never enter the
 * report. Waits for hydration before touching the form: a click on a
 * pre-hydration button fires no request, and a hydration pass resets values
 * typed before it. A blank or absent submit reads as a slow page and is
 * neither.
 */
export async function signIn(page, { webUrl, email, password }) {
  if (!email || !password)
    throw new Error('set Q18_PERF_EMAIL and Q18_PERF_PASSWORD')
  await page.goto(`${webUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  const hydrated = () =>
    Object.keys(document.body).some((k) => k.startsWith('__react')) ||
    Object.keys(document.documentElement).some((k) => k.startsWith('__react'))
  await page.waitForFunction(hydrated, null, { timeout: 60_000 })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel('Email').fill(email)
    await page.getByLabel('Password').fill(password)
    const stuck = await page
      .waitForFunction(
        () => {
          const emailInput = document.querySelector('input[type="email"]')
          const passwordInput = document.querySelector('input[type="password"]')
          return Boolean(
            emailInput?.value &&
            passwordInput?.value &&
            emailInput.value.length,
          )
        },
        null,
        { timeout: 4_000 },
      )
      .then(() => true)
      .catch(() => false)
    if (!stuck) {
      await page.reload({ waitUntil: 'domcontentloaded' })
      continue
    }
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/api/auth/sign-in/email')),
      page.getByRole('button', { name: 'Continue' }).click(),
    ])
    if (response.ok()) {
      await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
        timeout: 30_000,
      })
      return
    }
    await page.reload({ waitUntil: 'domcontentloaded' })
  }
  throw new Error('sign-in did not succeed after 3 attempts')
}

export async function waitForPort(port, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const open = await new Promise((resolve) => {
      const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
        socket.end()
        resolve(true)
      })
      socket.on('error', () => resolve(false))
      socket.setTimeout(1000, () => {
        socket.destroy()
        resolve(false)
      })
    })
    if (open) return
    if (Date.now() > deadline)
      throw new Error(
        `SSR server did not listen on ${port} within ${timeoutMs}ms`,
      )
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Refuse to measure a port this run did not bind. `waitForPort` alone would
 * accept any listener already there, so a leftover server from an earlier run
 * would be measured as this run's artifact.
 */
export async function assertPortFree(port) {
  const occupied = await new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port }, () => {
      socket.end()
      resolve(true)
    })
    socket.on('error', () => resolve(false))
    socket.setTimeout(1000, () => {
      socket.destroy()
      resolve(false)
    })
  })
  if (occupied)
    throw new Error(
      `port ${port} is already in use; refusing to measure a server this run did not start`,
    )
}
