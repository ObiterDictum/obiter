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
  await openMatterDocument(page, matterName)
}

/**
 * The post-sign-in leg, shared by the first tab and by sibling tabs in the
 * same context, which are already authenticated.
 */
async function openMatterDocument(page: Page, matterName: string) {
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
  // getByText resolves to the mode rail's document link first (the rail sits
  // before the matter list in DOM order), so the click navigates to the
  // document route. That navigation remounts the workspace ~200-500ms later;
  // typing into the matter pane's workspace meanwhile is the flake this pins
  // down. Await the route commit and the detail chrome so the paragraph probe
  // can only see the surviving workspace, not the outgoing pane's.
  const documentRow = page.getByRole('link', { name: fixtureName }).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()
  await expect(page).toHaveURL(/\/matters\/[^/?#]+\/documents\/[^/?#]+$/)
  await expect(page.getByRole('link', { name: 'Back to matter' })).toBeVisible({
    timeout: 30_000,
  })

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
 * Activates Save and types through the flight, returning the characters that
 * were sent. `activate` is the input path under test — a pointer click or
 * keyboard focus plus Enter. A few keys land while the request is out;
 * releasing the held model then starts the reload mid-burst and typing
 * continues until the save boundary has resolved — `data-save-state` leaves
 * `saving` — plus two more characters, so the burst provably straddles the
 * model swap on a document of any size.
 */
async function typeThroughFlight(
  page: Page,
  marker: string,
  activate: () => Promise<void>,
) {
  const releaseModel = await holdNextModelFetch(page)
  await activate()
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

  const typed = await typeThroughFlight(page, ' ryZNINE1234567890', () =>
    save(page).click(),
  )

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

test('typing through a keyboard-activated save flight keeps every character', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7F keys ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E7CKEYSb')
  await expect(editor(page)).toHaveValue(/E7CKEYSb$/)

  // Tab+Enter is the keyboard save path: activation leaves DOM focus on the
  // button, and `saving` disables it, so the browser would drop focus to
  // document.body and lose the whole burst. The save must hand focus back to
  // the caret's field before the flight starts.
  const typed = await typeThroughFlight(page, ' kEYS9876543210', async () => {
    await save(page).focus()
    await page.keyboard.press('Enter')
    await expect(editor(page)).toBeFocused({ timeout: 2_000 })
  })

  await expect
    .poll(() => saveState(page), { message: 'flight settled' })
    .not.toBe('saving')
  await expect(editor(page)).toHaveValue(`${BODY} E7CKEYSb${typed}`)
  expect(await saveState(page)).toBe('unsaved')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, BODY)
    await expect(editor(reloaded)).toHaveValue(`${BODY} E7CKEYSb${typed}`)
  } finally {
    await fresh.close()
  }
})

test('typing through a keyboard-activated banner retry keeps every character', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7F retry ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E7CBANNEd')
  await expect(editor(page)).toHaveValue(/E7CBANNEd$/)

  // Abort the first edit request so the failure banner and its Retry save
  // control appear; the retry itself reaches the real API.
  let aborted = false
  await page.route('**/api/documents/*/edit', async (route) => {
    if (aborted) {
      await route.continue()
      return
    }
    aborted = true
    await route.abort()
  })
  await save(page).click()
  const retry = page.getByRole('button', { name: 'Retry save', exact: true })
  await expect(retry).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => saveState(page), { message: 'failure banner shown' })
    .toBe('failed')

  // Enter on the focused retry used to leave focus on the button while the
  // retry cleared the failure and unmounted it, dropping focus to
  // document.body and losing the whole burst.
  const typed = await typeThroughFlight(page, ' baNNER1234567890', async () => {
    await retry.focus()
    await page.keyboard.press('Enter')
    await expect(editor(page)).toBeFocused({ timeout: 2_000 })
  })

  await expect
    .poll(() => saveState(page), { message: 'flight settled' })
    .not.toBe('saving')
  await expect(editor(page)).toHaveValue(`${BODY} E7CBANNEd${typed}`)
  expect(await saveState(page)).toBe('unsaved')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, BODY)
    await expect(editor(reloaded)).toHaveValue(`${BODY} E7CBANNEd${typed}`)
  } finally {
    await fresh.close()
  }
})

test('typing after a keyboard-activated discard confirm keeps every character', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7F discard ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // An unsaved draft parked against the opened version. A sibling tab sharing
  // this context's storage commits the next version, so this tab's reload
  // surfaces the stale-draft banner — a pure discard: confirming unmounts
  // the banner that holds the dialog's trigger.
  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E7CPARKED')
  await expect(editor(page)).toHaveValue(/E7CPARKED$/)
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Object.keys(window.localStorage).some((key) =>
            key.startsWith('obiter.document-draft.'),
          ),
        ),
      { message: 'draft persisted' },
    )
    .toBe(true)

  const sibling = await page.context().newPage()
  try {
    await sibling.goto('/')
    await openMatterDocument(sibling, matter)
    await caretAtEnd(sibling, BODY)
    await sibling.keyboard.type(' E7CSAVED')
    await saveAndWait(sibling)

    await page.reload()
    await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
      timeout: 30_000,
    })
    const trigger = page.getByRole('button', {
      name: 'Discard unsaved changes',
      exact: true,
    })
    await expect(trigger).toBeVisible({ timeout: 30_000 })
    await caretAtEnd(page, 'Delta paragraph E7CSAVED')

    // Enter on the focused confirm disables it for the flight, so the browser
    // drops focus to document.body; the close then restores focus to a trigger
    // the discard already unmounted. Without a rescue the typed burst is lost.
    await trigger.click()
    const confirm = page.getByRole('button', {
      name: 'Discard parked changes',
      exact: true,
    })
    await confirm.focus()
    await page.keyboard.press('Enter')
    await expect(confirm).toBeHidden({ timeout: 10_000 })
    await expect(editor(page)).toBeFocused({ timeout: 2_000 })

    await page.keyboard.type(' E7CKEEP')
    await expect(editor(page)).toHaveValue('Delta paragraph E7CSAVED E7CKEEP')
    await saveAndWait(page)
  } finally {
    await sibling.close()
  }

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, BODY)
    await expect(editor(reloaded)).toHaveValue(
      'Delta paragraph E7CSAVED E7CKEEP',
    )
  } finally {
    await fresh.close()
  }
})

test('typing after a keyboard-activated reload-and-discard confirm keeps every character', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7F reload ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E7CDROP')
  await expect(editor(page)).toHaveValue(/E7CDROP$/)

  // Abort the edit so the failure banner carries the reload-and-discard
  // dialog; the reload itself is real and remounts the editor.
  await page.route('**/api/documents/*/edit', (route) => route.abort())
  await save(page).click()
  const trigger = page.getByRole('button', {
    name: 'Reload and discard',
    exact: true,
  })
  await expect(trigger).toBeVisible({ timeout: 30_000 })
  await expect
    .poll(() => saveState(page), { message: 'failure banner shown' })
    .toBe('failed')

  // Keep a caret so the rescue has a target, then keyboard-activate the
  // confirm: pending disables it mid-flight, the close restores to a trigger
  // the banner unmounted, and the reload remounts the caret's field.
  await caretAtEnd(page, BODY)
  await trigger.click()
  const confirm = page.getByRole('button', {
    name: 'Discard unsaved work',
    exact: true,
  })
  await confirm.focus()
  await page.keyboard.press('Enter')
  await expect(confirm).toBeHidden({ timeout: 10_000 })
  await page.unroute('**/api/documents/*/edit')

  await expect(editor(page)).toBeFocused({ timeout: 10_000 })
  await page.keyboard.press('End')
  await page.keyboard.type(' E7CKEPT')
  await expect(editor(page)).toHaveValue(`${BODY} E7CKEPT`)
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, BODY)
    await expect(editor(reloaded)).toHaveValue(`${BODY} E7CKEPT`)
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

  const typed = await typeThroughFlight(page, ' ryZNINE1234567890', () =>
    save(page).click(),
  )

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
