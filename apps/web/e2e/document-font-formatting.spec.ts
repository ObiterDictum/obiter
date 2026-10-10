import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

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

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
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

async function createAccount(request: APIRequestContext) {
  // A UUID keeps the synthetic account id unique without an insecure PRNG,
  // which CodeQL flags even in test fixtures.
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e2-${runId}@obiter.test`
  const password = `E2-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E2 User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)
  return { email, password }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
  await page.getByLabel('Password').click()
  await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')
}

/** Opens the synthetic fixture through the product's own navigation. */
async function openFixtureDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
) {
  await signIn(page, email, password)

  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matterName }).first()
  if ((await matterLink.count()) === 0) {
    await page.getByRole('button', { name: 'Create matter' }).first().click()
    await page.getByLabel('Matter name').fill(matterName)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('button', { name: 'Create matter', exact: true })
      .last()
      .click()
    await page
      .getByRole('button', { name: 'Cancel' })
      .click({ timeout: 5_000 })
      .catch(() => undefined)
  }
  await page.getByRole('link', { name: matterName }).first().click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 20_000 })

  const fixtureName = path.basename(fixturePath())
  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(fixturePath())
  }
  const documentRow = page.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true })
const paragraph = (page: Page, text: string) =>
  page.locator('[data-paragraph-id]', { hasText: text }).first()

/** The Font family / size / colour selects, exact at rest. */
const fontFamily = (page: Page) => page.getByLabel('Font', { exact: true })
const fontSize = (page: Page) => page.getByLabel('Font size', { exact: true })
const fontColour = (page: Page) =>
  page.getByLabel('Font colour', { exact: true })

async function focusParagraph(page: Page, text: string) {
  const target = paragraph(page, text)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) return
  }
  throw new Error(`could not focus the paragraph containing "${text}"`)
}

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

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
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
  const { email, password } = await createAccount(request)
  const matter = `E2 font ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

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
    await openFixtureDocument(reloaded, email, password, matter)
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
  const { email, password } = await createAccount(request)
  const matter = `E2 clear ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

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
  const { email, password } = await createAccount(request)
  const matter = `E2 tracked ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

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
