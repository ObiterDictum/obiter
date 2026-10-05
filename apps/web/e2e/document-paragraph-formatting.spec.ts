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
 * E3 browser journey: Align, Line spacing and Indent must agree end to end.
 * Only a real browser decides the painted paragraph CSS, the native selection
 * the custom selection mirrors, and a fresh context reading the stored version
 * back; the mounted suites cover the projection and the save plan.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. The fixture is the repo's synthetic DOCX.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E3_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function createAccount(request: APIRequestContext) {
  // A UUID keeps the synthetic account id unique without an insecure PRNG,
  // which CodeQL flags even in test fixtures.
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e3-${runId}@obiter.test`
  const password = `E3-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E3 User', email, password },
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
const save = (page: Page) => page.getByRole('button', { name: 'Save' })
const paragraph = (page: Page, text: string) =>
  page.locator('[data-paragraph-id]', { hasText: text }).first()
const alignCentre = (page: Page) =>
  page.getByRole('button', { name: 'Align centre' })
const lineSpacing = (page: Page) =>
  page.getByLabel('Line spacing', { exact: true })
const indent = (page: Page) => page.getByLabel('Indent', { exact: true })

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

/** The inline paragraph layout the browser paints on the target block. */
async function paragraphStyle(page: Page, text: string) {
  return page.evaluate((value) => {
    const roots = [...document.querySelectorAll('[data-paragraph-id]')]
    const match = roots.find((root) => root.textContent?.includes(value))
    if (!(match instanceof HTMLElement)) return null
    return {
      textAlign: match.style.textAlign,
      textIndent: match.style.textIndent,
      lineHeight: match.style.lineHeight,
    }
  }, text)
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('align, line spacing and indent paint, save, and reload from a fresh context', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E3 paragraph ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await focusParagraph(page, HEADING)
  const defaultStyle = await paragraphStyle(page, HEADING)

  await alignCentre(page).click()
  await expect(alignCentre(page)).toHaveAttribute('aria-pressed', 'true')
  await lineSpacing(page).selectOption('1.5')
  await expect(lineSpacing(page)).toHaveValue('1.5')

  await page.getByRole('tab', { name: 'Layout' }).click()
  await indent(page).selectOption('first')
  await expect(indent(page)).toHaveValue('first')

  // The chosen options and the painted paragraph agree: centred text, a 1.5
  // line box, and Word's half-inch first-line indent (720 twips = 48px).
  const painted = await paragraphStyle(page, HEADING)
  expect(painted?.textAlign).toBe('center')
  expect(painted?.textIndent).toBe('48px')
  expect(Number.parseFloat(painted?.lineHeight ?? '0')).toBeGreaterThan(
    Number.parseFloat(defaultStyle?.lineHeight ?? '0'),
  )
  await shot(page, '01-paragraph-formatting-applied')

  await saveAndWait(page)
  await shot(page, '02-paragraph-formatting-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_paragraph_format',
      alignment: 'center',
      lineSpacing: { line: 360, lineRule: 'auto' },
      indentation: { firstLine: 720 },
    }),
  )

  // A fresh context reads the stored version back: the paint and the control
  // values come only from the saved paragraph properties.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, HEADING)
    await expect(alignCentre(reloaded)).toHaveAttribute('aria-pressed', 'true')
    await expect(lineSpacing(reloaded)).toHaveValue('1.5')
    await reloaded.getByRole('tab', { name: 'Layout' }).click()
    await expect(indent(reloaded)).toHaveValue('first')

    const reloadedStyle = await paragraphStyle(reloaded, HEADING)
    expect(reloadedStyle?.textAlign).toBe('center')
    expect(reloadedStyle?.textIndent).toBe('48px')
    await shot(reloaded, '03-paragraph-formatting-reopened')
  } finally {
    await fresh.close()
  }
})
