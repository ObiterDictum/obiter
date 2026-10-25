import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fixturePath } from './support'

/*
 * E2 browser journey: Font family, Font size, Font colour and Clear formatting
 * must agree end to end. Only a real browser decides the painted run CSS, the
 * native text selection the custom selection mirrors, and a fresh context
 * reading the stored version back; the mounted suites cover the projection and
 * the save plan.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. The fixture is the repo's synthetic DOCX.
 */

/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
/** Six code units, so the selection never cuts a surrogate pair. */
const SELECTED = 'IN THE'
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E2_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

/** The Font family / size / colour selects, exact at rest. */
const fontFamily = (page: Page) => page.getByLabel('Font', { exact: true })
const fontSize = (page: Page) => page.getByLabel('Font size', { exact: true })
const fontColour = (page: Page) =>
  page.getByLabel('Font colour', { exact: true })

/** A native within-paragraph selection the custom selection mirrors. */
async function selectFirst(page: Page, text: string, units: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Home')
  for (let step = 0; step < units; step += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
}

async function paintedStyle(page: Page, text: string) {
  return page.evaluate((value) => {
    const spans = [
      ...document.querySelectorAll('[data-caret-run-overlay] span'),
    ]
    const match = spans.find((span) => span.textContent === value)
    if (!(match instanceof HTMLElement)) return null
    return {
      fontFamily: match.style.fontFamily,
      fontSize: match.style.fontSize,
      color: match.style.color,
      fontWeight: match.style.fontWeight,
      textDecoration: match.style.textDecoration,
      backgroundColor: match.style.backgroundColor,
    }
  }, text)
}

async function enableTracking(page: Page) {
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Track changes off' }).click()
  await page.getByRole('tab', { name: 'Home' }).click()
}

type EditBody = {
  trackChanges?: boolean
  operations?: Array<Record<string, unknown>>
}

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('font family, size and colour paint, save, and reload from a fresh context', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E2')
  const matter = `E2 font ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await selectFirst(page, HEADING, SELECTED.length)

  await fontFamily(page).selectOption('Georgia')
  await fontSize(page).selectOption({ label: '12' })
  await fontColour(page).selectOption('FF0000')

  // The chosen options and the painted run agree; 12pt is 24 half-points,
  // which the paint renders at 16px.
  await expect(fontFamily(page)).toHaveValue('Georgia')
  await expect(fontSize(page)).toHaveValue('24')
  await expect(fontColour(page)).toHaveValue('FF0000')
  const style = await paintedStyle(page, SELECTED)
  expect(style?.fontFamily).toContain('Georgia')
  expect(style?.fontSize).toBe('16px')
  expect(style?.color).toBe('rgb(255, 0, 0)')
  await shot(page, '01-font-formatting-applied')

  await saveAndWait(page)
  await shot(page, '02-font-formatting-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      fontFamily: 'Georgia',
      fontSize: 24,
      colour: 'FF0000',
    }),
  )

  // A fresh context reads the stored version back: the paint and the select
  // values come only from the saved run properties.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await selectFirst(reloaded, HEADING, SELECTED.length)
    await expect(fontFamily(reloaded)).toHaveValue('Georgia')
    await expect(fontSize(reloaded)).toHaveValue('24')
    await expect(fontColour(reloaded)).toHaveValue('FF0000')
    const reloadedStyle = await paintedStyle(reloaded, SELECTED)
    expect(reloadedStyle?.fontFamily).toContain('Georgia')
    expect(reloadedStyle?.fontSize).toBe('16px')
    expect(reloadedStyle?.color).toBe('rgb(255, 0, 0)')
    await shot(reloaded, '03-font-formatting-reopened')
  } finally {
    await fresh.close()
  }
})

test('clear formatting removes direct character formatting and saves nulls', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E2')
  const matter = `E2 clear ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await selectFirst(page, HEADING, SELECTED.length)
  await fontFamily(page).selectOption('Georgia')
  await fontSize(page).selectOption({ label: '12' })
  await fontColour(page).selectOption('FF0000')
  await page.getByRole('button', { name: 'Bold' }).click()
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect((await paintedStyle(page, SELECTED))?.fontFamily).toContain('Georgia')

  await page.getByRole('button', { name: 'Clear formatting' }).click()

  // Every direct property is released, so the select values fall back and the
  // bold control reads unpressed even if a style still paints bold.
  await expect(fontFamily(page)).toHaveValue('')
  await expect(fontSize(page)).toHaveValue('')
  await expect(fontColour(page)).toHaveValue('')
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  const cleared = await paintedStyle(page, SELECTED)
  expect(cleared?.fontFamily ?? '').not.toContain('Georgia')
  expect(cleared?.fontSize).not.toBe('16px')
  expect(cleared?.color).not.toBe('rgb(255, 0, 0)')
  await shot(page, '04-font-formatting-cleared')

  await saveAndWait(page)
  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      bold: null,
      italic: null,
      underline: null,
      strikethrough: null,
      fontFamily: null,
      fontSize: null,
      colour: null,
      highlight: null,
      vertAlign: null,
      smallCaps: null,
    }),
  )
})

test('queues font formatting and clear formatting on a tracked partial selection', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E2')
  const matter = `E2 tracked ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await enableTracking(page)
  await selectFirst(page, HEADING, SELECTED.length)

  // A tracked range split is recorded as a w:rPrChange, so the font controls
  // and Clear formatting stay available and queue a draft instead of
  // refusing.
  await expect(fontFamily(page)).toBeEnabled()
  await expect(fontSize(page)).toBeEnabled()
  await expect(fontColour(page)).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Clear formatting', exact: true }),
  ).toBeEnabled()

  await fontFamily(page).selectOption('Georgia')
  await fontSize(page).selectOption({ label: '12' })
  await expect(fontFamily(page)).toHaveValue('Georgia')
  await expect(fontSize(page)).toHaveValue('24')
  const trackedStyle = await paintedStyle(page, SELECTED)
  expect(trackedStyle?.fontFamily).toContain('Georgia')
  expect(trackedStyle?.fontSize).toBe('16px')
  await shot(page, '05-tracked-range-queued')

  await saveAndWait(page)

  // The batch flew tracked and addressed the selection as a paragraph range,
  // the address a mid-run split has to carry.
  expect(editBodies.at(-1)?.trackChanges).toBe(true)
  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      paragraphId: expect.any(String),
      from: 0,
      to: SELECTED.length,
      fontFamily: 'Georgia',
      fontSize: 24,
    }),
  )
})
