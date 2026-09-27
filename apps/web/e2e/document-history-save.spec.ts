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
 * E50 browser journey: undo across a successful save must persist the reversal
 * exactly once, and a saved structural edit must never be replayed as a fresh
 * insertion. The mounted suites cover the state machine; this journey exists
 * for what only a real browser and a real API decide: the saved model reloading
 * with re-parsed identities, and a fresh context reading the stored version
 * back.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; email verification is marked directly in the task-owned test
 * database, never the shared one. The fixture is the repo's synthetic DOCX.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
// Set to a directory to capture the repaired behaviour stage by stage (the PR
// evidence column); a normal run writes nothing.
const shots = process.env.E50_E2E_SHOTS

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
  const email = `e50-${runId}@obiter.test`
  const password = `E50-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E50 User', email, password },
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
const undo = (page: Page) => page.getByRole('button', { name: 'Undo' })
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

async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

function uniqueParagraphCount(page: Page) {
  return page.$$eval(
    '[data-paragraph-id]',
    (nodes) =>
      new Set(nodes.map((node) => node.getAttribute('data-paragraph-id'))).size,
  )
}

/** The count once two consecutive reads agree, so a late render is not read mid-flight. */
async function settledParagraphCount(page: Page) {
  let previous = -1
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await uniqueParagraphCount(page)
    if (current > 0 && current === previous) return current
    previous = current
    await page.waitForTimeout(100)
  }
  return previous
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

/** Saves a pending tracked rejection and waits for the decision version. */
async function saveAndWaitForDecision(page: Page) {
  const decision = page.waitForResponse(
    (response) => response.url().includes('/tracked-changes/decision'),
    { timeout: 30_000 },
  )
  await save(page).click()
  await decision
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

async function enableTracking(page: Page) {
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Track changes off' }).click()
  await page.getByRole('tab', { name: 'Home' }).click()
}

test.use({ viewport: { width: 1440, height: 900 } })

test('undo after a save persists the reverted text once', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E50 text ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await caretAtEnd(page, HEADING)
  await page.keyboard.type(' E50TEXT')
  await expect(editor(page)).toHaveValue(/E50TEXT$/)
  await shot(page, '01-text-typed')
  await saveAndWait(page)
  await shot(page, '02-text-saved')

  // Undo the saved typing against the saved document, then persist it.
  for (let step = 0; step < ' E50TEXT'.length; step += 1) {
    await undo(page).click()
  }
  await expect(editor(page)).not.toHaveValue(/E50TEXT/)
  await shot(page, '03-text-undone-after-save')
  await saveAndWait(page)

  // A fresh context reads the stored version back: the reversal must be what
  // was persisted, not the text the first save wrote.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, HEADING)
    await expect(editor(reloaded)).not.toHaveValue(/E50TEXT/)
    await shot(reloaded, '04-text-reopened-no-marker')
  } finally {
    await fresh.close()
  }
})

test('undo of a saved insert does not persist a duplicate paragraph', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E50 insert ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await focusParagraph(page, HEADING)
  const before = await settledParagraphCount(page)

  await page.getByRole('button', { name: 'Insert paragraph' }).click()
  const pending = page.getByLabel('Pending paragraph text', { exact: true })
  await expect(pending).toBeVisible({ timeout: 10_000 })
  // One character is one history step, so two undos remove the text and then
  // the insert itself.
  await pending.pressSequentially('X')
  await shot(page, '05-insert-typed')
  await saveAndWait(page)

  // Undo the typing, then the insert itself: the paragraph is removed against
  // the saved document, not queued for a second insertion.
  await undo(page).click()
  await undo(page).click()
  await expect
    .poll(() => uniqueParagraphCount(page), { message: 'insert undone' })
    .toBe(before)
  await shot(page, '06-insert-undone-after-save')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    // Exactly one paragraph was removed, and the saved insert was not replayed:
    // the count is the original, never before + 1 or before + 2.
    await expect
      .poll(() => uniqueParagraphCount(reloaded), {
        message: 'no duplicate paragraph after save-undo-save',
      })
      .toBe(before)
  } finally {
    await fresh.close()
  }
})

test('undo of a saved tracked edit rejects the change and persists the reversal', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E50 tracked ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await enableTracking(page)
  await caretAtEnd(page, HEADING)
  await page.keyboard.type(' TRACKED')
  await expect(editor(page)).toHaveValue(/TRACKED$/)
  await shot(page, '07-tracked-typed')
  await saveAndWait(page)
  await shot(page, '08-tracked-saved')

  // Undo the saved tracked edit; the reversal is a tracked-change rejection.
  for (let step = 0; step < ' TRACKED'.length; step += 1) {
    await undo(page).click()
  }
  await shot(page, '09-tracked-undone')
  await saveAndWaitForDecision(page)
  await shot(page, '10-tracked-reversal-saved')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, HEADING)
    await expect(editor(reloaded)).not.toHaveValue(/TRACKED/)
    await shot(reloaded, '11-tracked-reopened-no-marker')
  } finally {
    await fresh.close()
  }
})
