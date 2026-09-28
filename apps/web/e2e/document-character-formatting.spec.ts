import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'

/*
 * E53 browser journey: Strikethrough, Highlight, Superscript and Subscript
 * must agree end to end. Only a real browser decides the painted run CSS, the
 * native text selection the custom selection mirrors, and a fresh context
 * reading the stored version back; the mounted suites cover the projection and
 * the save plan.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; email verification is marked directly in the task-owned test
 * database, never the shared one. The fixture is the repo's synthetic DOCX.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
/** Six code units, so the selection never cuts a surrogate pair. */
const SELECTED = 'IN THE'
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E53_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

function verifyEmailInDb(email: string) {
  const safe = email.replace(/'/g, "''")
  execFileSync(
    'docker',
    [
      'exec',
      'obiter-postgres',
      'psql',
      '-U',
      'obiter',
      '-d',
      databaseName,
      '-c',
      `update users set "emailVerified"=true where email='${safe}'`,
    ],
    { stdio: 'pipe' },
  )
}

async function createAccount(request: APIRequestContext) {
  // A UUID keeps the synthetic account id unique without an insecure PRNG,
  // which CodeQL flags even in test fixtures.
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e53-${runId}@obiter.test`
  const password = `E53-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E53 User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(email)
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
    // The dialog stays mounted after a successful create; dismiss it so the
    // matter row underneath is clickable. Escape is not reliable here.
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
      textDecoration: match.style.textDecoration,
      backgroundColor: match.style.backgroundColor,
      verticalAlign: match.style.verticalAlign,
    }
  }, text)
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

/** The painted state each control's aria-pressed must agree with. */
async function expectPressedAgreesWithPaint(page: Page, text: string) {
  const style = await paintedStyle(page, text)
  const pressed = async (name: string) =>
    (await page.getByRole('button', { name }).getAttribute('aria-pressed')) ===
    'true'
  expect(await pressed('Strikethrough')).toBe(
    style?.textDecoration.includes('line-through') ?? false,
  )
  expect(await pressed('Highlight')).toBe((style?.backgroundColor ?? '') !== '')
  expect(await pressed('Superscript')).toBe(style?.verticalAlign === 'super')
  expect(await pressed('Subscript')).toBe(style?.verticalAlign === 'sub')
}

async function enableTracking(page: Page) {
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Track changes off' }).click()
  await page.getByRole('tab', { name: 'Home' }).click()
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('character formatting paints, saves, and reloads from a fresh context', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E53 format ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await selectFirst(page, HEADING, SELECTED.length)

  await page.getByRole('button', { name: 'Strikethrough' }).click()
  await page.getByRole('button', { name: 'Highlight' }).click()
  await page.getByRole('button', { name: 'Superscript' }).click()

  await expect(
    page.getByRole('button', { name: 'Strikethrough' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Highlight' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await expect(
    page.getByRole('button', { name: 'Superscript' }),
  ).toHaveAttribute('aria-pressed', 'true')
  await expect(page.getByRole('button', { name: 'Subscript' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )
  expect(await paintedStyle(page, SELECTED)).toMatchObject({
    verticalAlign: 'super',
  })
  expect((await paintedStyle(page, SELECTED))?.textDecoration).toContain(
    'line-through',
  )
  expect((await paintedStyle(page, SELECTED))?.backgroundColor).not.toBe('')
  await expectPressedAgreesWithPaint(page, SELECTED)

  // Superscript and subscript are one slot: choosing subscript releases
  // superscript, and choosing superscript back restores it for the save.
  await page.getByRole('button', { name: 'Subscript' }).click()
  await expect(
    page.getByRole('button', { name: 'Superscript' }),
  ).toHaveAttribute('aria-pressed', 'false')
  await expect(page.getByRole('button', { name: 'Subscript' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  expect((await paintedStyle(page, SELECTED))?.verticalAlign).toBe('sub')
  await page.getByRole('button', { name: 'Superscript' }).click()
  await expectPressedAgreesWithPaint(page, SELECTED)
  await shot(page, '01-character-formatting-applied')

  await saveAndWait(page)
  await shot(page, '02-character-formatting-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_run_emphasis',
      strikethrough: true,
      highlight: 'yellow',
      vertAlign: 'superscript',
    }),
  )

  // A fresh context reads the stored version back: the pressed state and the
  // painted CSS come only from the saved run properties.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await selectFirst(reloaded, HEADING, SELECTED.length)
    await expect(
      reloaded.getByRole('button', { name: 'Strikethrough' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      reloaded.getByRole('button', { name: 'Highlight' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      reloaded.getByRole('button', { name: 'Superscript' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await expect(
      reloaded.getByRole('button', { name: 'Subscript' }),
    ).toHaveAttribute('aria-pressed', 'false')
    const reloadedStyle = await paintedStyle(reloaded, SELECTED)
    expect(reloadedStyle?.verticalAlign).toBe('super')
    expect(reloadedStyle?.textDecoration).toContain('line-through')
    expect(reloadedStyle?.backgroundColor).not.toBe('')
    await expectPressedAgreesWithPaint(reloaded, SELECTED)
    await shot(reloaded, '03-character-formatting-reopened')
  } finally {
    await fresh.close()
  }
})

test('refuses partial character formatting under track changes', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E53 tracked ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await enableTracking(page)
  await selectFirst(page, HEADING, SELECTED.length)

  // A tracked range split has no rPrChange writer, so every Home character
  // control holds and surfaces the refusal instead of painting a change the
  // save would drop.
  for (const label of [
    'Strikethrough',
    'Highlight',
    'Superscript',
    'Subscript',
  ]) {
    await expect(
      page.getByRole('button', {
        name: new RegExp(`^${label}: Partial formatting is not yet recorded`),
      }),
    ).toBeDisabled()
  }
  await shot(page, '04-tracked-range-refusal')
})
