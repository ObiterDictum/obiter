import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fixturePath } from './support'
import {
  choose,
  openFormatting,
  selectedValue,
  setTrackChanges,
} from './editor-chrome'

const HEADING = 'IN THE HIGH COURT OF JUSTICE'
const SELECTED = 'IN THE'
const shots = process.env.E2_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const fontFamily = (page: Page) => selectedValue(page, 'Font')
const fontSize = (page: Page) => selectedValue(page, 'Font size')
const fontColour = (page: Page) => selectedValue(page, 'Font colour')

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
  await setTrackChanges(page, true)
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

  await choose(page, 'Font', 'Georgia')
  await choose(page, 'Font size', '12')
  await choose(page, 'Font colour', 'Red')

  await expect(fontFamily(page)).toHaveText('Georgia')
  await expect(fontSize(page)).toHaveText('12')
  await expect(fontColour(page)).toHaveText('Red')
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

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await selectFirst(reloaded, HEADING, SELECTED.length)
    await openFormatting(reloaded)
    await expect(fontFamily(reloaded)).toHaveText('Georgia')
    await expect(fontSize(reloaded)).toHaveText('12')
    await expect(fontColour(reloaded)).toHaveText('Red')
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
  await choose(page, 'Font', 'Georgia')
  await choose(page, 'Font size', '12')
  await choose(page, 'Font colour', 'Red')
  await page.getByRole('button', { name: 'Bold' }).click()
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect((await paintedStyle(page, SELECTED))?.fontFamily).toContain('Georgia')

  await page.getByRole('button', { name: 'Clear formatting' }).click()

  await expect(fontFamily(page)).toHaveText('Default font')
  await expect(fontSize(page)).toHaveText('Default')
  await expect(fontColour(page)).toHaveText('Automatic')
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

  await openFormatting(page)
  await expect(fontFamily(page)).toBeEnabled()
  await expect(fontSize(page)).toBeEnabled()
  await expect(fontColour(page)).toBeEnabled()
  await expect(
    page.getByRole('button', { name: 'Clear formatting', exact: true }),
  ).toBeEnabled()

  await choose(page, 'Font', 'Georgia')
  await choose(page, 'Font size', '12')
  await expect(fontFamily(page)).toHaveText('Georgia')
  await expect(fontSize(page)).toHaveText('12')
  const trackedStyle = await paintedStyle(page, SELECTED)
  expect(trackedStyle?.fontFamily).toContain('Georgia')
  expect(trackedStyle?.fontSize).toBe('16px')
  await shot(page, '05-tracked-range-queued')

  await saveAndWait(page)

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
