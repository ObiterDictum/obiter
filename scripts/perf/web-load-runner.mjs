#!/usr/bin/env node
/*
 * Production page-load measurement runner.
 *
 * Measures a running web target with a headless Chromium on fixed journeys and
 * writes one sanitised JSON report. It is explicit about the conditions it can
 * tell apart, because conflating them is how a measurement ends up proving the
 * wrong thing:
 *
 *   --cache cold|warm     a fresh browser context per sample (empty HTTP cache)
 *                         versus re-navigating inside one context
 *   --nav hard|client     page.goto versus clicking the in-app link
 *   --emulate-network     none, or a labelled CDP profile (fast3g, slow4g)
 *   --serve-prod <dir>    start apps/web/serve.mjs behind a local gateway that
 *                         mirrors production's same-origin /api split
 *
 * It refuses to measure unless the target's API reports the expected checkout
 * root and commit, so a stale or shared server cannot be measured by accident.
 * Credentials come from the environment and never enter the report.
 *
 * Usage:
 *   Q18_PERF_EMAIL=... Q18_PERF_PASSWORD=... \
 *     node scripts/perf/web-load-runner.mjs \
 *       --serve-prod /path/to/worktree \
 *       --web-url http://localhost:3002 --api-url http://localhost:8789 \
 *       --expect-checkout /path/to/worktree \
 *       --fixtures scripts/perf/fixtures.example.json \
 *       --journeys sign-in,home,matters --samples 5 --out /tmp/perf.json
 */
import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import net from 'node:net'
import { chromium } from '@playwright/test'
import { JOURNEYS, resolvePath } from './journeys.mjs'
import { startGateway } from './gateway.mjs'

const NETWORK_PROFILES = {
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

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const webUrl = arg('web-url', 'http://localhost:3002')
const apiUrl = arg('api-url', 'http://localhost:8789')
const expectCheckout = arg('expect-checkout')
const serveProd = arg('serve-prod')
const outPath = arg('out')
const label = arg('label', 'run')
const samples = Number(arg('samples', '5'))
const cacheMode = arg('cache', 'cold')
const navMode = arg('nav', 'hard')
const network = arg('emulate-network', 'none')
const journeyIds = arg('journeys')
const fixturesPath = arg('fixtures')
const email = process.env.Q18_PERF_EMAIL
const password = process.env.Q18_PERF_PASSWORD

if (cacheMode !== 'cold' && cacheMode !== 'warm')
  throw new Error('--cache cold|warm')
if (navMode !== 'hard' && navMode !== 'client')
  throw new Error('--nav hard|client')
if (network !== 'none' && !NETWORK_PROFILES[network])
  throw new Error(`unknown --emulate-network "${network}"`)

const INIT_SCRIPT = () => {
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

/** Fail loudly rather than polling a target whose identity is unknown. */
async function assertTargetIdentity() {
  const healthUrl = `${apiUrl}/api/health`
  const res = await fetch(healthUrl).catch((error) => {
    throw new Error(
      `API health fetch failed for ${healthUrl}: ${error.message}`,
    )
  })
  if (!res.ok) throw new Error(`API health returned ${res.status} at ${apiUrl}`)
  const body = await res.json()
  const provenance = body?.provenance
  if (!provenance?.checkoutRoot || !provenance?.commitSha)
    throw new Error('API health carries no provenance; refusing to measure it')
  if (expectCheckout && provenance.checkoutRoot !== expectCheckout)
    throw new Error(
      `API checkout root is ${provenance.checkoutRoot}, expected ${expectCheckout}`,
    )
  const signInUrl = `${webUrl}/sign-in`
  const page = await fetch(signInUrl).catch((error) => {
    throw new Error(`web fetch failed for ${signInUrl}: ${error.message}`)
  })
  if (!page.ok) throw new Error(`web /sign-in returned ${page.status}`)
  const html = await page.text()
  if (!html.includes('Sign in to Obiter'))
    throw new Error('web target did not render the sign-in page')
  return {
    checkoutRoot: provenance.checkoutRoot,
    commitSha: provenance.commitSha,
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
async function milestones(page, selector) {
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
async function collect(page, contentMs, readyMs, sinceMs) {
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

async function signIn(page) {
  if (!email || !password)
    throw new Error('set Q18_PERF_EMAIL and Q18_PERF_PASSWORD')
  await page.goto(`${webUrl}/sign-in`, { waitUntil: 'domcontentloaded' })
  // Wait for hydration before touching the form: a click on a pre-hydration
  // button fires no request, and a hydration pass resets values typed before
  // it. A blank or absent submit reads as a slow page and is neither.
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

async function waitForPort(port, timeoutMs = 20_000) {
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

async function sample({ context, journey, fixtures }) {
  const page = await context.newPage()
  if (network !== 'none') {
    const client = await context.newCDPSession(page)
    await client.send('Network.enable')
    await client.send(
      'Network.emulateNetworkConditions',
      NETWORK_PROFILES[network],
    )
  }
  let contentMs
  let readyMs
  let sinceMs = 0
  if (navMode === 'client' && journey.clientNavFrom) {
    const from = resolvePath(journey.clientNavFrom, fixtures)
    await page.goto(`${webUrl}${from}`, { waitUntil: 'domcontentloaded' })
    await milestones(page, 'main')
    const link = page.getByRole('link', { name: journey.clientNavName }).first()
    sinceMs = await page.evaluate(() => performance.now())
    await link.click()
    const mark = await milestones(page, journey.ready)
    contentMs = mark.contentMs - sinceMs
    readyMs = mark.readyMs - sinceMs
  } else {
    const target = resolvePath(journey.path, fixtures)
    await page.goto(`${webUrl}${target}`, { waitUntil: 'domcontentloaded' })
    const mark = await milestones(page, journey.ready)
    contentMs = mark.contentMs
    readyMs = mark.readyMs
    sinceMs = 0
  }
  const metrics = await collect(page, contentMs, readyMs, sinceMs)
  await page.close()
  return metrics
}

function median(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2
}

function summarise(rows) {
  const out = { samples: rows }
  for (const key of Object.keys(rows[0] ?? {})) {
    if (typeof rows[0][key] !== 'number') continue
    const values = rows.map((row) => row[key])
    out[`${key}Median`] = Math.round(median(values))
    out[`${key}Min`] = Math.min(...values)
    out[`${key}Max`] = Math.max(...values)
  }
  return out
}

async function withTarget(options) {
  if (!options.serveProd)
    return { identity: await assertTargetIdentity(), stop: async () => {} }
  const port = Number(new URL(options.webUrl).port)
  const ssr = spawn(process.execPath, ['serve.mjs'], {
    cwd: `${options.serveProd}/apps/web`,
    env: {
      ...process.env,
      PORT: '3102',
      HOST: '127.0.0.1',
      OBITER_WEB_ORIGIN: options.webUrl,
      OBITER_API_ORIGIN: options.apiUrl,
    },
    stdio: 'ignore',
  })
  await waitForPort(3102)
  const gateway = await startGateway({
    port,
    ssrOrigin: 'http://127.0.0.1:3102',
    apiOrigin: options.apiUrl,
  })
  const identity = await assertTargetIdentity()
  return {
    identity,
    stop: async () => {
      await new Promise((resolve) => gateway.close(resolve))
      ssr.kill('SIGTERM')
    },
  }
}

async function main() {
  const fixtures = fixturesPath
    ? JSON.parse(await readFile(fixturesPath, 'utf8'))
    : {}
  const selected = journeyIds ? journeyIds.split(',') : null
  const journeys = JOURNEYS.filter((j) => !selected || selected.includes(j.id))
  if (journeys.length === 0) throw new Error('no journeys selected')

  const target = await withTarget({ serveProd, webUrl, apiUrl })
  const browser = await chromium.launch()
  const results = []
  try {
    const authContext = await browser.newContext()
    await authContext.addInitScript(INIT_SCRIPT)
    await signIn(await authContext.newPage())
    const storageState = await authContext.storageState()
    await authContext.close()

    for (const journey of journeys) {
      const contextOptions = {
        storageState: journey.public ? undefined : storageState,
        viewport: { width: 1440, height: 900 },
      }
      const context =
        cacheMode === 'warm' ? await browser.newContext(contextOptions) : null
      if (context) await context.addInitScript(INIT_SCRIPT)
      if (context) await sample({ context, journey, fixtures })
      const rows = []
      for (let i = 0; i < samples; i++) {
        const scoped = context ?? (await browser.newContext(contextOptions))
        if (!context) await scoped.addInitScript(INIT_SCRIPT)
        rows.push(await sample({ context: scoped, journey, fixtures }))
        if (!context) await scoped.close()
      }
      if (context) await context.close()
      results.push({ id: journey.id, ...summarise(rows) })
    }
  } finally {
    await browser.close()
    await target.stop()
  }

  const report = {
    label,
    conditions: {
      cache: cacheMode,
      nav: navMode,
      network,
      samples,
      webUrl,
      apiUrl,
    },
    target: target.identity,
    results,
  }
  const json = JSON.stringify(report, null, 2)
  if (outPath) await writeFile(outPath, json)
  console.log(json)
}

main().catch((error) => {
  console.error(`perf runner failed: ${error.message}`)
  process.exit(1)
})
