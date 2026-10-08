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
 * E10 browser journey: a saved edit creates a second immutable version, the
 * Versions list offers the superseded one for read-only viewing and for a
 * real comparison, and returning to the current version restores the live
 * editor. The account is synthetic and created through the product's own
 * sign-up endpoint; email verification is marked directly in the task-owned
 * test database, never the shared one. The fixture is the repo's synthetic
 * DOCX.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
/** Text typed into the current version — the marker the diff must surface. */
const MARKER = 'E10MARK'

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
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e10-${runId}@obiter.test`
  const password = `E10-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E10 User', email, password },
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

async function focusParagraph(page: Page, text: string) {
  const target = page.locator('[data-paragraph-id]', { hasText: text }).first()
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

test('versions: edit saves v2, v1 opens read-only, compare shows the change', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matterName = `E10 Matter ${crypto.randomUUID().slice(0, 6)}`
  await openFixtureDocument(page, email, password, matterName)

  // Edit the current version and save — this creates v2 and leaves the
  // uploaded v1 behind as history.
  await focusParagraph(page, HEADING)
  await page.keyboard.press('Home')
  await page.keyboard.type(`${MARKER} `)
  const saveButton = page.getByRole('button', { name: 'Save' })
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  await saveButton.click()
  await expect(saveButton).toBeDisabled({ timeout: 30_000 })

  // A draft typed now and never saved must survive the round-trip into
  // history: the editor unmounts for the read-only view and its persisted
  // per-tab draft restores when the live editor remounts.
  await focusParagraph(page, 'BETWEEN:')
  await page.keyboard.press('End')
  await page.keyboard.type(' DRAFTX')

  // The Versions section now lists v2 as current and v1 as history.
  const historicalRow = page.locator('li', { hasText: 'v1 ·' }).first()
  await expect(historicalRow).toBeVisible({ timeout: 15_000 })

  // Open the historical version: it is read-only — painted pages, no
  // paragraph editor, no Save control — and it shows the pre-edit text.
  await historicalRow.getByRole('button', { name: 'View' }).click()
  await expect(page.getByText('Read only')).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('button', { name: 'Back to current version' }),
  ).toBeVisible()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: HEADING }).first(),
  ).toBeVisible({ timeout: 30_000 })
  // The marker exists only in v2: it must not appear in the v1 view.
  await expect(page.getByText(MARKER)).toHaveCount(0)
  expect(await editor(page).count()).toBe(0)
  expect(await saveButton.count()).toBe(0)

  // Compare v1 (base) against v2 (target): the picker defaults to exactly
  // that pair, so Compare alone proves the entries render.
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const comparison = page.locator('[data-version-comparison]')
  await expect(comparison).toBeVisible({ timeout: 30_000 })
  await expect(comparison.getByText('Paragraph modified')).toBeVisible()
  await expect(comparison.getByText(MARKER)).toBeVisible()

  // Back to current returns to the live editor: the saved edit is painted
  // and the unsaved draft came back with the remounted workspace.
  await page.getByRole('button', { name: 'Back to current version' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: MARKER }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'DRAFTX' }).first(),
  ).toBeVisible({ timeout: 30_000 })
})
