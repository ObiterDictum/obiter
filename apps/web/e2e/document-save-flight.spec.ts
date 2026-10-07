import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { verifyEmailInDb } from './support'

/*
 * Save-flight regression journey: a keystroke typed while a save is landing
 * used to be silently dropped. The saved model reloads with canonical
 * paragraph ids, so the focused editor's subtree remounts; while the caret
 * retarget and refocus waited on passive effects, keys delivered in that
 * window fell through to `document.body` and never reached the draft state.
 * The stored version then held a contiguous slice short of what was typed.
 *
 * Only a real browser decides this: the loss is DOM focus, invisible to the
 * mounted suites. Each test holds the model refetch so the reload lands in
 * the middle of the typed burst — some characters precede the swap, some
 * cross it — then a fresh context proves every character was stored.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const HEADING = 'E4 Heading'
const BODY = 'Delta paragraph'

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e7f-${runId}@obiter.test`
  const password = `E7f-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E7F User', email, password },
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

/** Opens the fixture document through the product's own navigation. */
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

  const fixtureName = path.basename(FIXTURE)
  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(FIXTURE)
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
const saveState = (page: Page) =>
  page.locator('[data-save-state]').getAttribute('data-save-state')
const headingParagraphs = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: HEADING })

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

async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'References') {
  await page.getByRole('tab', { name, exact: true }).first().click()
}

/**
 * Holds the first model refetch of the next save until released, so the
 * reload — and the paragraph-id swap it carries — lands in the middle of a
 * typed burst rather than before or after it.
 */
async function holdNextModelFetch(page: Page) {
  let release = () => {}
  const held = new Promise<void>((resolve) => {
    release = resolve
  })
  let armed = true
  await page.route('**/api/documents/*/model', async (route) => {
    if (!armed) {
      await route.continue()
      return
    }
    armed = false
    const response = await route.fetch()
    await held
    await route.fulfill({ response })
  })
  return release
}

/**
 * Clicks Save and types through the flight, returning the characters that
 * were sent. A few land while the request is out; releasing the held model
 * then starts the reload mid-burst and typing continues until the save
 * boundary has resolved — `data-save-state` leaves `saving` — plus two more
 * characters, so the burst provably straddles the model swap on a document
 * of any size.
 */
async function typeThroughFlight(page: Page, marker: string) {
  const releaseModel = await holdNextModelFetch(page)
  await save(page).click()
  const keys = [...marker]
  let index = 0
  for (; index < Math.min(5, keys.length); index += 1) {
    await page.keyboard.press(keys[index]!)
    await page.waitForTimeout(45)
  }
  releaseModel()
  let resolved = 0
  while (index < keys.length) {
    const state = await saveState(page)
    resolved = state !== 'saving' ? resolved + 1 : 0
    if (resolved > 2) break
    await page.keyboard.press(keys[index]!)
    index += 1
    await page.waitForTimeout(45)
  }
  return marker.slice(0, index)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('typing through the save flight keeps every character', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7F flight ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E7CBOUNDa')
  await expect(editor(page)).toHaveValue(/E7CBOUNDa$/)

  const typed = await typeThroughFlight(page, ' ryZNINE1234567890')

  // The burst landed after the request was planned, so it must stay pending
  // and dirty — never silently lost — and the follow-up save persists it.
  await expect
    .poll(() => saveState(page), { message: 'flight settled' })
    .not.toBe('saving')
  await expect(editor(page)).toHaveValue(`${BODY} E7CBOUNDa${typed}`)
  expect(await saveState(page)).toBe('unsaved')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, BODY)
    await expect(editor(reloaded)).toHaveValue(`${BODY} E7CBOUNDa${typed}`)
  } finally {
    await fresh.close()
  }
})

test('typing through the save flight beside a stored table of contents and page break', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7F flight toc ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // Two headings for real entries and a page break so the body repaginates:
  // the structural save reshapes every paragraph id this flight crosses.
  await openRibbon(page, 'Home')
  await focusParagraph(page, HEADING)
  await page.getByRole('button', { name: 'Heading 1' }).click()
  await focusParagraph(page, 'Beta paragraph')
  await page.getByRole('button', { name: 'Heading 1' }).click()
  await focusParagraph(page, BODY)
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Page break' }).click()

  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await page.getByRole('button', { name: /Table of contents/ }).click()
  await expect(headingParagraphs(page)).toHaveCount(2)
  await saveAndWait(page)

  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E7CSTRUCT')
  await expect(editor(page)).toHaveValue(/E7CSTRUCT$/)

  const typed = await typeThroughFlight(page, ' ryZNINE1234567890')

  await expect
    .poll(() => saveState(page), { message: 'flight settled' })
    .not.toBe('saving')
  await expect(editor(page)).toHaveValue(`${BODY} E7CSTRUCT${typed}`)
  expect(await saveState(page)).toBe('unsaved')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, BODY)
    await expect(editor(reloaded)).toHaveValue(`${BODY} E7CSTRUCT${typed}`)
    await expect(headingParagraphs(reloaded)).toHaveCount(2)
  } finally {
    await fresh.close()
  }
})
