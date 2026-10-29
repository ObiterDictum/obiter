import { COLLECT_INIT_SCRIPT } from './page-metrics.mjs'

export const PARAGRAPH = '[data-paragraph-id]'
export const FIELD = 'textarea[aria-label="Paragraph text"]'

export const TYPED =
  'The parties agree that the boundary line runs as shown on the plan. '

export const TYPING_PROBE = () => {
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

export function summarise(values) {
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

async function waitForFieldValue(page, predicate, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const value = await page
      .locator(FIELD)
      .first()
      .inputValue()
      .catch(() => null)
    if (value !== null && predicate(value, want)) return true
    if (Date.now() > deadline) return false
    await page.waitForTimeout(100)
  }
}

async function waitForFocus(page, field, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    const focused = await field
      .evaluate((node) => document.activeElement === node)
      .catch(() => false)
    if (focused) return true
    if (Date.now() > deadline) return false
    await page.waitForTimeout(50)
  }
}

const changedFrom = (value, before) => value !== before
const contains = (value, want) => value.includes(want)

export function makeProbes({ webUrl, fixtures, authState, browser }) {
  async function newPage(ownership) {
    const context = await ownership.create(() =>
      browser.newContext({
        viewport: { width: 1440, height: 900 },
        storageState: authState,
      }),
    )
    await context.addInitScript(COLLECT_INIT_SCRIPT)
    return { context, page: await context.newPage() }
  }

  async function closePage(ownership, context) {
    await context.close()
    ownership.release(context)
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
    await page
      .locator(PARAGRAPH)
      .nth(2)
      .click({ force: true, timeout: 120_000 })
    const field = page.locator(FIELD).first()
    await field.waitFor({ state: 'visible', timeout: 60_000 })
    await waitForFocus(page, field)
    const before = await field.inputValue()
    await page.keyboard.type('x', { delay: 0 })
    const accepted = await waitForFieldValue(page, changedFrom, before, 60_000)
    const editableMs = Date.now() - started
    await page.keyboard.press('Backspace')
    return { paintedMs, editableMs, acceptedKeystroke: accepted }
  }

  async function typingSample(documentId, keys, ownership) {
    const { context, page } = await newPage(ownership)
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
      await closePage(ownership, context)
    }
  }

  async function scrollSample(documentId, ownership) {
    const { context, page } = await newPage(ownership)
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
      await closePage(ownership, context)
    }
  }

  async function saveSample(documentId, ownership) {
    const { context, page } = await newPage(ownership)
    try {
      const open = await openEditor(page, documentId)
      const marker = `zzmarker${Date.now()}`
      let typedInField = false
      for (let attempt = 0; attempt < 4 && !typedInField; attempt += 1) {
        await page.keyboard.type(marker, { delay: 20 })
        typedInField = await waitForFieldValue(page, contains, marker, 10_000)
      }
      const savedFrom = Date.now()
      const [response] = await Promise.all([
        page.waitForResponse(
          (r) => r.url().includes('/api/') && r.request().method() === 'POST',
          { timeout: 120_000 },
        ),
        page.getByRole('button', { name: 'Save' }).click(),
      ])
      const responseMs = Date.now() - savedFrom
      const saveStatus = response.status()
      await page.waitForTimeout(700)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await page.waitForSelector('[aria-label="Document page"]', {
        timeout: 180_000,
      })
      const reloadStarted = Date.now()
      const paragraphs = await page
        .locator(PARAGRAPH)
        .allInnerTexts()
        .catch(() => [])
      return {
        marker,
        ...open,
        typedInField,
        saveStatus,
        responseMs,
        reloadFoundMs: Date.now() - reloadStarted,
        persisted: paragraphs.some((text) => text.includes(marker)),
      }
    } finally {
      await closePage(ownership, context)
    }
  }

  return { typingSample, scrollSample, saveSample }
}
