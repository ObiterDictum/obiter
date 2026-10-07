import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { createSyntheticDocx } from '../../../packages/ooxml/src/index'
import { resolveJourneyTargets } from '../journey-target.mjs'

/*
 * E0 browser journey: the editor must never reach a zero-paragraph state.
 * This drives a real web and API stack with a synthetic one-paragraph DOCX,
 * proves the Delete paragraph control is unavailable with an accurate reason,
 * exercises the keyboard boundary, and then proves a valid deletion saves,
 * reloads and reopens as one valid paragraph.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; email verification is marked directly in the task-owned test
 * database, never the shared one. The DOCX is built in memory and contains
 * fictional text only.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const FIRST = 'E0 sole paragraph of the synthetic fixture.'
const SECOND = 'E0 second paragraph after insertion.'

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
  const email = `e0-${runId}@obiter.test`
  const password = `E0-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E0 User', email, password },
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

/** Uploads an in-memory one-paragraph DOCX and opens the editor. */
async function openSyntheticDocument(
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

  const filename = 'e0-last-paragraph.docx'
  const bytes = await createSyntheticDocx([FIRST])
  const fileInput = page.locator('input[aria-label="Upload document"]')
  await expect(fileInput).toBeAttached({ timeout: 20_000 })
  await fileInput.setInputFiles({
    name: filename,
    mimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    buffer: Buffer.from(bytes),
  })
  const documentRow = page.getByText(filename).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const deleteButton = (page: Page) =>
  page.getByRole('button', { name: /Delete paragraph/ })
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save' })
const undoButton = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const redoButton = (page: Page) =>
  page.getByRole('button', { name: 'Redo', exact: true })

function uniqueParagraphCount(page: Page) {
  return page.$$eval(
    '[data-paragraph-id]',
    (nodes) =>
      new Set(nodes.map((node) => node.getAttribute('data-paragraph-id'))).size,
  )
}

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

function saveState(page: Page) {
  return page
    .locator('[data-save-state]')
    .first()
    .getAttribute('data-save-state')
}

async function saveAndWait(page: Page) {
  await saveButton(page).click()
  await expect.poll(() => saveState(page), { timeout: 30_000 }).toBe('saved')
}

/** Fails the test if the page logged an error or a request failed. */
function watchForFaults(page: Page) {
  const faults: string[] = []
  page.on('pageerror', (error) => faults.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') faults.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? ''
    // An aborted request is a cancellation (a navigation, an unmount or the
    // context closing), not a product failure.
    if (error.includes('ERR_ABORTED')) return
    faults.push(`requestfailed: ${request.url()} ${error}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 500) {
      faults.push(`response ${String(response.status())}: ${response.url()}`)
    }
  })
  return faults
}

test.use({ viewport: { width: 1440, height: 900 } })

test('final-paragraph deletion is refused, valid deletion saves and reopens', async ({
  page,
  browser,
  request,
}) => {
  const faults = watchForFaults(page)
  const { email, password } = await createAccount(request)
  const matter = `E0 ${String(Date.now())}`
  await openSyntheticDocument(page, email, password, matter)

  // 7-8. One paragraph: Delete paragraph is unavailable with an accurate
  // accessible reason.
  await expect(page.locator('[data-paragraph-id]').first()).toContainText(FIRST)
  await expect(deleteButton(page)).toBeDisabled()
  await expect(deleteButton(page)).toHaveAttribute(
    'aria-label',
    'Delete paragraph: A document must contain at least one paragraph.',
  )

  // 9-11. Keyboard boundaries: Backspace at the start and Delete at the end of
  // the only paragraph must not remove it or dirty the document.
  await page.locator('[data-paragraph-id]').first().click()
  await expect(editor(page)).toHaveValue(FIRST)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Backspace')
  await expect(editor(page)).toHaveValue(FIRST)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Delete')
  await expect(editor(page)).toHaveValue(FIRST)
  expect(await settledParagraphCount(page)).toBe(1)
  expect(await saveState(page)).not.toBe('unsaved')
  await expect(saveButton(page)).toBeDisabled()

  // 12-13. A pending inserted paragraph is effective, so Delete becomes
  // available.
  await page.getByRole('button', { name: 'Insert paragraph' }).click()
  const pending = page.getByLabel('Pending paragraph text', { exact: true })
  await expect(pending).toBeVisible({ timeout: 10_000 })
  await pending.fill(SECOND)
  expect(await settledParagraphCount(page)).toBe(2)
  await expect(deleteButton(page)).toBeEnabled()
  await saveAndWait(page)
  expect(await settledParagraphCount(page)).toBe(2)

  // A whole-document selection delete joins the two paragraphs and must leave
  // one; undo restores both. This is the selection-deletion path, which cannot
  // reach zero paragraphs because a range needs two endpoints.
  await page.locator('[data-paragraph-id]').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  expect(await settledParagraphCount(page)).toBe(1)
  await undoButton(page).click()
  expect(await settledParagraphCount(page)).toBe(2)

  // 14-15. Delete the stored second paragraph; exactly one remains and the
  // surviving paragraph holds a usable, focused editor.
  await page.locator('[data-paragraph-id]', { hasText: SECOND }).first().click()
  await deleteButton(page).click()
  expect(await settledParagraphCount(page)).toBe(1)
  await expect(deleteButton(page)).toBeDisabled()
  await expect(editor(page)).toBeFocused()
  await expect(editor(page)).toHaveValue(FIRST)

  // 16-17. Undo restores both; redo removes the second again.
  await undoButton(page).click()
  expect(await settledParagraphCount(page)).toBe(2)
  await redoButton(page).click()
  expect(await settledParagraphCount(page)).toBe(1)

  // 18. Save the valid deletion.
  await saveAndWait(page)

  // 19-21. A fresh context reopens the stored version: one valid paragraph.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  const freshFaults = watchForFaults(reloaded)
  try {
    await openSyntheticDocument(reloaded, email, password, matter)
    expect(await settledParagraphCount(reloaded)).toBe(1)
    await expect(reloaded.locator('[data-paragraph-id]').first()).toContainText(
      FIRST,
    )
    await expect(deleteButton(reloaded)).toBeDisabled()
    expect(freshFaults).toEqual([])
  } finally {
    await fresh.close()
  }

  expect(faults).toEqual([])
})
