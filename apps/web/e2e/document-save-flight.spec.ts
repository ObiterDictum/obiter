import { verifyEmailInDb } from './support'
import { signIn, focusParagraph, saveAndWait } from './e13-support'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'
import {
  closeMenu,
  menuItem,
  openMenu,
  openRibbonTab,
  runMenuCommand,
} from './editor-chrome'

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

async function openFixtureDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
) {
  await signIn(page, email, password)
  await openMatterDocument(page, matterName)
}

async function openMatterDocument(page: Page, matterName: string) {
  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matterName }).first()
  if ((await matterLink.count()) === 0) {
    await page
      .getByRole('button', { name: /^(New matter|Create the first matter)$/ })
      .first()
      .click()
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

async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'References') {
  await openRibbonTab(page, name)
}

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

  for (const text of [HEADING, 'Beta paragraph']) {
    await focusParagraph(page, text)
    await openMenu(page, 'Format')
    await menuItem(page, 'Heading 1').click()
    await closeMenu(page)
  }
  await focusParagraph(page, BODY)
  await openRibbon(page, 'Insert')
  await runMenuCommand(page, 'Insert', 'Page break')

  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitem', { name: 'Table of contents', exact: true })
    .click()
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
