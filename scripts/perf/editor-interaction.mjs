#!/usr/bin/env node
/*
 * Editor interaction measurement: the costs a page-load journey cannot see.
 *
 * `web-load-runner.mjs` measures opening a document. This measures using one:
 * typing-to-paint latency, scrolling frame health, the save round-trip and
 * whether the saved text survives a reload. It reuses that runner's target
 * lifecycle (`withTarget`) rather than starting a second harness stack, so the
 * same provenance gates apply: the API must name the expected checkout and the
 * served artifact must match the build marker on disk.
 *
 * Only the harness is shared; the browser work is editor-specific. Typing is
 * measured as the interval from each keydown to the second animation frame that
 * follows its keyup, which is when the edit has been laid out and painted.
 *
 * Usage:
 *   Q18_PERF_EMAIL=... Q18_PERF_PASSWORD=... \
 *     node scripts/perf/editor-interaction.mjs \
 *       --serve-prod "$PWD" --expect-artifact-commit "$(git rev-parse HEAD)" \
 *       --web-url http://localhost:3003 --api-url http://localhost:8790 \
 *       --expect-checkout "$PWD" --fixtures fixtures.json \
 *       --samples 5 --keys 40 --out /tmp/editor-interaction.json
 *
 * `--fixtures` needs `matterId`, `documentId` and (for --save) `saveDocumentId`,
 * a separate document so saved versions never accumulate on the one whose
 * opening time is being reported.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { COLLECT_INIT_SCRIPT, signIn } from './page-metrics.mjs'
import { withTarget } from './web-load-runner.mjs'

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}
const webUrl = arg('web-url', 'http://localhost:3003')
const apiUrl = arg('api-url', 'http://localhost:8790')
const outPath = arg('out')
const label = arg('label', 'run')
const samples = Number(arg('samples', '5'))
const keys = Number(arg('keys', '40'))
const ssrPort = Number(arg('ssr-port', '3102'))
const fixturesPath = arg('fixtures')
const email = process.env.Q18_PERF_EMAIL
const password = process.env.Q18_PERF_PASSWORD
const modes = (arg('modes', 'typing,scroll,save') ?? '').split(',')

// Typed verbatim in every sample so Before and After pay the same edit cost.
const TYPED =
  'The parties agree that the boundary line runs as shown on the plan. '
const PARAGRAPH = '[data-paragraph-id]'

/** Install the per-keystroke latency probe. It records on `window.__lat`. */
const TYPING_PROBE = () => {
  window.__lat = []
  window.__frames = []
  let start = null
  addEventListener(
    'keydown',
    () => {
      start = performance.now()
    },
    true,
  )
  addEventListener(
    'keyup',
    () => {
      if (start === null) return
      const began = start
      start = null
      requestAnimationFrame(() =>
        requestAnimationFrame(() =>
          window.__lat.push(performance.now() - began),
        ),
      )
    },
    true,
  )
  let last = performance.now()
  const tick = () => {
    const now = performance.now()
    window.__frames.push(now - last)
    last = now
    if (window.__frames.length < 1200) requestAnimationFrame(tick)
  }
  requestAnimationFrame(tick)
}

function summarise(values) {
  const sorted = [...values].sort((a, b) => a - b)
  const q = (p) =>
    sorted.length === 0
      ? null
      : Math.round(
          sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))],
        )
  return {
    n: sorted.length,
    p50Ms: q(0.5),
    p95Ms: q(0.95),
    maxMs: sorted.length ? Math.round(sorted[sorted.length - 1]) : null,
  }
}

async function newPage(browser) {
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: authState,
  })
  await context.addInitScript(COLLECT_INIT_SCRIPT)
  return { context, page: await context.newPage() }
}

async function openEditor(page, documentId) {
  const started = Date.now()
  await page.goto(
    `${webUrl}/matters/${fixtures.matterId}/documents/${documentId}`,
    { waitUntil: 'domcontentloaded' },
  )
  await page.waitForSelector('[aria-label="Document page"]', {
    timeout: 180_000,
  })
  const paintedMs = Date.now() - started
  // Genuinely editable, not merely painted: a paragraph accepts focus and a
  // keystroke changes the field, which is what a user's first edit depends on.
  await page.locator(PARAGRAPH).nth(2).click()
  const field = page.locator('textarea[aria-label="Paragraph text"]').first()
  await field.waitFor({ state: 'visible', timeout: 60_000 })
  const before = await field.inputValue()
  await page.keyboard.type('x', { delay: 0 })
  await field.evaluate(
    (node, was) =>
      new Promise((resolve) => {
        if (node.value !== was) return resolve()
        const stop = Date.now() + 20_000
        const poll = () =>
          node.value !== was || Date.now() > stop
            ? resolve()
            : setTimeout(poll, 50)
        poll()
      }),
    before,
  )
  const editableMs = Date.now() - started
  await page.keyboard.press('Backspace')
  return { paintedMs, editableMs }
}

async function typingSample(browser, documentId) {
  const { context, page } = await newPage(browser)
  try {
    const open = await openEditor(page, documentId)
    await page.evaluate(TYPING_PROBE)
    await page.keyboard.type(TYPED.repeat(Math.ceil(keys / TYPED.length)), {
      delay: 25,
    })
    await page.waitForTimeout(400)
    const { latencies, longTasks, frames } = await page.evaluate(
      (n) => ({
        latencies: window.__lat.slice(0, n),
        longTasks: window.__perf.longTasks,
        frames: window.__frames,
      }),
      keys,
    )
    return {
      ...open,
      typedKeys: latencies.length,
      latency: summarise(latencies),
      longTasks: longTasks.length,
      longTaskTotalMs: Math.round(longTasks.reduce((a, d) => a + d, 0)),
      totalBlockingMs: Math.round(
        longTasks.reduce((a, d) => a + Math.max(0, d - 50), 0),
      ),
      frameGaps: summarise(frames),
      framesOver50ms: frames.filter((f) => f > 50).length,
    }
  } finally {
    await context.close()
  }
}

async function scrollSample(browser, documentId) {
  const { context, page } = await newPage(browser)
  try {
    await openEditor(page, documentId)
    await page.evaluate(TYPING_PROBE)
    const desk = page.locator('[data-document-desk]').first()
    await desk.hover()
    for (let i = 0; i < 40; i += 1) {
      await page.mouse.wheel(0, 600)
      await page.waitForTimeout(16)
    }
    await page.waitForTimeout(300)
    const { frames, longTasks } = await page.evaluate(() => ({
      frames: window.__frames,
      longTasks: window.__perf.longTasks,
    }))
    return {
      frameGaps: summarise(frames),
      framesOver50ms: frames.filter((f) => f > 50).length,
      totalBlockingMs: Math.round(
        longTasks.reduce((a, d) => a + Math.max(0, d - 50), 0),
      ),
    }
  } finally {
    await context.close()
  }
}

/**
 * Save round-trip and persisted reload. The text must still be there after a
 * reload of the same document, so this asserts the saved version rather than
 * the round-trip alone.
 */
async function saveSample(browser, documentId) {
  const { context, page } = await newPage(browser)
  try {
    await openEditor(page, documentId)
    const marker = `E59-${Date.now()}`
    await page.keyboard.type(marker, { delay: 15 })
    await page.waitForTimeout(300)
    const started = Date.now()
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().includes('/api/') && r.request().method() === 'POST',
        { timeout: 120_000 },
      ),
      page.keyboard.press('ControlOrMeta+s'),
    ])
    const responseMs = Date.now() - started
    const status = response.status()
    await page.waitForTimeout(700)
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForSelector('[aria-label="Document page"]', {
      timeout: 180_000,
    })
    const reloadStarted = Date.now()
    const found = await page
      .locator(PARAGRAPH)
      .filter({ hasText: marker })
      .first()
      .waitFor({ timeout: 60_000 })
      .then(() => true)
      .catch(() => false)
    return {
      marker,
      saveStatus: status,
      responseMs,
      reloadFoundMs: Date.now() - reloadStarted,
      persisted: found,
    }
  } finally {
    await context.close()
  }
}

const fixtures = JSON.parse(await readFile(fixturesPath, 'utf8'))
const documentId = arg('document-id', fixtures.documentId)
const saveDocumentId = arg('save-document-id', fixtures.saveDocumentId)

let authState = null
const browser = await chromium.launch()
const target = await withTarget({
  serveProd: arg('serve-prod'),
  webUrl,
  apiUrl,
  expectCheckout: arg('expect-checkout'),
  expectArtifactCommit: arg('expect-artifact-commit'),
  allowUnverifiedArtifact: process.argv.includes('--allow-unverified-artifact'),
  ssrPort,
})

const results = {}
try {
  const authContext = await browser.newContext()
  await signIn(await authContext.newPage(), { webUrl, email, password })
  authState = await authContext.storageState()
  await authContext.close()

  for (const mode of modes) {
    const run =
      mode === 'typing'
        ? typingSample
        : mode === 'scroll'
          ? scrollSample
          : mode === 'save'
            ? saveSample
            : null
    if (!run) throw new Error(`unknown mode "${mode}"`)
    const id = mode === 'save' ? saveDocumentId : documentId
    if (!id)
      throw new Error(`--fixtures needs a document id for mode "${mode}"`)
    const rows = []
    for (let i = 0; i < samples; i += 1) {
      rows.push({ index: i, ...(await run(browser, id)) })
    }
    results[mode] = {
      samples: rows,
      typedKeysPerSample: mode === 'typing' ? keys : undefined,
      latencyP50Ms: rows.map((r) => r.latency?.p50Ms).filter((v) => v != null),
      latencyP95Ms: rows.map((r) => r.latency?.p95Ms).filter((v) => v != null),
      paintedMs: rows.map((r) => r.paintedMs),
      editableMs: rows.map((r) => r.editableMs),
      frameP95Ms: rows.map((r) => r.frameGaps?.p95Ms).filter((v) => v != null),
      framesOver50ms: rows.map((r) => r.framesOver50ms),
      totalBlockingMs: rows.map((r) => r.totalBlockingMs),
    }
  }
} finally {
  await browser.close()
  await target.stop()
}

const report = {
  label,
  conditions: { samples, keys, modes, webUrl, apiUrl },
  target: target.identity,
  results,
}
const json = JSON.stringify(report, null, 2)
if (outPath) await writeFile(outPath, json)
console.log(json)
