import { chromium } from '@playwright/test'
import { execFileSync } from 'node:child_process'

const apiOrigin = 'http://127.0.0.1:8805'
const webOrigin = 'http://localhost:3018'
const database = 'obiter_backend_review_pane_e2e'
const out = '/tmp/review-pane-shots'

const runId = Math.random().toString(36).slice(2, 8)
const email = `shots-${runId}@obiter.test`
const password = `E2e-${runId}-Aa1!`

const signUp = await fetch(`${apiOrigin}/api/auth/sign-up/email`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', Origin: webOrigin },
  body: JSON.stringify({ name: 'Shots User', email, password }),
})
if (!signUp.ok) throw new Error(`sign-up failed ${await signUp.text()}`)
execFileSync('psql', [
  '-h',
  '127.0.0.1',
  '-U',
  'obiter',

  '-d',
  database,
  '-c',
  `update users set "emailVerified"=true where email='${email}'`,
])

const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (message) => {
  if (message.type() === 'error') console.log('console:', message.text())
})

await page.goto(`${webOrigin}/sign-in`, { waitUntil: 'networkidle' })
await page.getByLabel('Email').click()
await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
await page.getByLabel('Password').click()
await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
await page.getByRole('button', { name: 'Sign in', exact: true }).click()
await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
  timeout: 30000,
})
await page.waitForLoadState('networkidle')
await page.waitForTimeout(2000)
const guide = page.getByRole('dialog', { name: 'Welcome to Obiter' })
if (await guide.isVisible().catch(() => false)) {
  await guide.getByRole('button', { name: 'Skip' }).click()
  await guide.waitFor({ state: 'hidden' })
}

async function upload(file, label) {
  await page.goto(`${webOrigin}/redact`)
  await page
    .getByLabel('Upload a document to redact')
    .setInputFiles(file)
  await page.waitForURL(/\/redact\/red_/, { timeout: 120000 })
  await page
    .getByRole('button', { name: 'Finalise', exact: true })
    .waitFor({ timeout: 120000 })
  await page.waitForTimeout(2500)
  console.log(`run ready: ${label} ${page.url()}`)
}

await upload(
  '/home/karl/.t3/worktrees/obiter/t3-e73c4158-2831d5fa54a0deef/data/evals/redact/demo-fixture.docx',
  'word',
)

const metrics = () =>
  page.evaluate(() => {
    const desk = document.querySelector('[data-document-desk]')
    const frame = document.querySelector('[data-document-sheet-frame]')
    const page = document.querySelector('[data-document-sheet]')
    const main = document.querySelector('main')
    const board = document.querySelector('[role="group"][aria-label="Review view"]')
    const doc = document.documentElement
    const rect = (element) => {
      if (!element) return null
      const box = element.getBoundingClientRect()
      return {
        width: Math.round(box.width),
        right: Math.round(box.right),
        left: Math.round(box.left),
      }
    }
    return {
      main: rect(main),
      desk: rect(desk),
      deskScrollWidth: desk ? desk.scrollWidth : null,
      deskClientWidth: desk ? desk.clientWidth : null,
      frame: rect(frame),
      page: rect(page),
      pageZoom: frame ? frame.getAttribute('data-page-zoom') : null,
      switchVisible: board
        ? getComputedStyle(board).display !== 'none'
        : null,
      docScroll: doc.scrollWidth - doc.clientWidth,
      zoomLabel: document.querySelector(
        '[aria-label="Zoom page"] span',
      )?.textContent,
    }
  })

console.log('WORD 1440 metrics', await metrics())
await page.screenshot({ path: `${out}/word-1440-fit.png` })

await page.getByRole('button', { name: 'Zoom to 100%' }).click()
await page.waitForTimeout(1500)
console.log('WORD 1440 at 100%', await metrics())
await page.screenshot({ path: `${out}/word-1440-100.png` })

await page.getByRole('button', { name: 'Fit width' }).click()
await page.waitForTimeout(800)

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(1500)
console.log('WORD 390 metrics', await metrics())
await page.screenshot({ path: `${out}/word-390-page.png` })
await page.getByRole('button', { name: 'Spans' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/word-390-spans.png` })
console.log('WORD 390 spans', await metrics())

await page.setViewportSize({ width: 1440, height: 900 })
await page.waitForTimeout(800)

await upload(
  '/home/karl/work/backend-review-pane/services/api/test-fixtures/upload-corpus/letter-footnotes-numbering.docx',
  'letter',
)
console.log('LETTER 1440 metrics', await metrics())
await page.screenshot({ path: `${out}/letter-1440-fit.png` })
await page.getByRole('button', { name: 'Zoom in' }).click()
await page.getByRole('button', { name: 'Zoom in' }).click()
await page.waitForTimeout(800)
console.log('LETTER 1440 zoomed', await metrics())
await page.screenshot({ path: `${out}/letter-1440-zoomed.png` })

await upload(
  '/home/karl/.t3/worktrees/obiter/t3-e73c4158-2831d5fa54a0deef/data/evals/redact/pdf-text-layer-fixture.pdf',
  'pdf',
)
console.log('PDF 1440 metrics', await metrics())
await page.screenshot({ path: `${out}/pdf-1440-fit.png` })
await page.getByRole('button', { name: 'Zoom to 100%' }).click()
await page.waitForTimeout(1500)
console.log('PDF 1440 at 100%', await metrics())
await page.screenshot({ path: `${out}/pdf-1440-100.png` })

await page.setViewportSize({ width: 390, height: 844 })
await page.waitForTimeout(1200)
await page.getByRole('button', { name: 'Page' }).click()
await page.waitForTimeout(600)
console.log('PDF 390 page', await metrics())
await page.screenshot({ path: `${out}/pdf-390-page.png` })
await page.getByRole('button', { name: 'Spans' }).click()
await page.waitForTimeout(600)
await page.screenshot({ path: `${out}/pdf-390-spans.png` })

await page.setViewportSize({ width: 1440, height: 900 })
await page.goto(`${webOrigin}/redact`)
await page.waitForTimeout(2500)
await page.screenshot({ path: `${out}/runs-1440.png` })
const railText = await page.evaluate(() => {
  const panel = document.querySelector('[aria-label="Redaction runs"]')
  return panel
    ? Array.from(panel.querySelectorAll('p,a,span'))
        .map((node) => node.textContent?.trim())
        .filter(Boolean)
        .slice(0, 20)
    : null
})
console.log('runs page text', railText)
await page.goto(`${webOrigin}/matters`)
await page.waitForTimeout(1500)

await browser.close()
