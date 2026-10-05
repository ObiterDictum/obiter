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
 * E1 browser journey: the Clipboard ribbon controls, a multi-paragraph paste
 * as one undo step, the native paste path, and the Ctrl/Cmd+B/I/U layer. Only a
 * real browser decides the clipboard integration, the native paste event and
 * the painted run; the mounted suites cover the projection, the pure splitter
 * and the history grouping.
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
const shots = process.env.E1_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function createAccount(request: APIRequestContext) {
  // A UUID keeps the synthetic account id unique without an insecure PRNG,
  // which CodeQL flags even in test fixtures.
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e1-${runId}@obiter.test`
  const password = `E1-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E1 User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)
  return { email, password }
}

async function signIn(page: Page, email: string, password: string) {
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel('Email').click()
    await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
    await page.getByLabel('Password').click()
    await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
    const typed = await expect(page.getByLabel('Email'))
      .toHaveValue(email, { timeout: 4_000 })
      .then(() => true)
      .catch(() => false)
    if (!typed) {
      await page.reload({ waitUntil: 'networkidle' })
      continue
    }
    await page.getByRole('button', { name: 'Continue' }).click()
    const signedIn = await page
      .waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
        timeout: 15_000,
      })
      .then(() => true)
      .catch(() => false)
    if (signedIn) {
      await page.waitForLoadState('networkidle')
      return
    }
  }
  throw new Error('sign-in did not leave the sign-in route')
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
const copyButton = (page: Page) => page.getByRole('button', { name: /^Copy/ })
const cutButton = (page: Page) => page.getByRole('button', { name: /^Cut/ })
const pasteButton = (page: Page) =>
  page.getByRole('button', { name: 'Paste', exact: true })
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
async function selectFirst(page: Page, units: number) {
  await page.keyboard.press('Home')
  for (let step = 0; step < units; step += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
}

test.use({
  viewport: { width: 1440, height: 900 },
  permissions: ['clipboard-read', 'clipboard-write'],
})

test('enables the clipboard controls from the document selection', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E1 clipboard ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await expect(copyButton(page)).toBeDisabled()
  await expect(cutButton(page)).toBeDisabled()
  await expect(pasteButton(page)).toBeEnabled()
  await expect(copyButton(page)).toHaveAttribute(
    'aria-label',
    'Copy: Select text to copy',
  )
  await expect(cutButton(page)).toHaveAttribute(
    'aria-label',
    'Cut: Select text to cut',
  )
  await shot(page, '01-clipboard-disabled-without-a-selection')

  await focusParagraph(page, HEADING)
  await selectFirst(page, 6)
  await expect(copyButton(page)).toBeEnabled()
  await expect(cutButton(page)).toBeEnabled()
  await expect(copyButton(page)).toHaveAttribute('aria-label', 'Copy')
  await shot(page, '02-clipboard-enabled-with-a-selection')

  // Copy writes the selection and leaves the document alone.
  const before = await page.locator('[data-paragraph-id]').count()
  await copyButton(page).click()
  await expect(page.locator('[data-paragraph-id]')).toHaveCount(before)
  await shot(page, '03-copied-without-mutating')
})

test('pastes multiple paragraphs and undoes it in one step', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E1 paste ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await focusParagraph(page, HEADING)
  await page.keyboard.press('End')
  const before = await page.locator('[data-paragraph-id]').count()

  await page.evaluate(() =>
    navigator.clipboard.writeText('Alpha paragraph\nBeta paragraph'),
  )
  await pasteButton(page).click()
  // Two pasted lines split into one extra paragraph, not a hard break inside
  // one; the ribbon read the clipboard and applied the same splitter the native
  // paste event uses.
  await expect(page.locator('[data-paragraph-id]')).toHaveCount(before + 1)
  await shot(page, '04-multi-paragraph-paste')

  // One paste is one history entry: a single undo restores the document.
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(page.locator('[data-paragraph-id]')).toHaveCount(before)
  await shot(page, '05-paste-undone-in-one-step')
})

test('pastes newlines through the native event and survives a save', async ({
  page,
  request,
  browser,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E1 native paste ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await focusParagraph(page, HEADING)
  await page.keyboard.press('End')
  const before = await page.locator('[data-paragraph-id]').count()

  await page.evaluate(() =>
    navigator.clipboard.writeText('Native one\nNative two'),
  )
  await editor(page).press('Control+V')
  await expect(page.locator('[data-paragraph-id]')).toHaveCount(before + 1)
  await shot(page, '06-native-paste-split')

  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled({
    timeout: 30_000,
  })
  await shot(page, '07-native-paste-saved')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect(reloaded.locator('[data-paragraph-id]')).toHaveCount(
      before + 1,
    )
    await expect(
      reloaded.locator('[data-paragraph-id]', {
        hasText: 'Native one',
      }),
    ).toHaveCount(1)
    await shot(reloaded, '08-native-paste-after-reload')
  } finally {
    await fresh.close()
  }
})

test('toggles bold from the keyboard and saves it', async ({
  page,
  request,
  browser,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E1 bold ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await focusParagraph(page, HEADING)
  await selectFirst(page, 6)

  await page.keyboard.press('Control+b')
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-pressed',
    'true',
  )
  await shot(page, '09-keyboard-bold-applied')
  await page.keyboard.press('Control+b')
  await expect(page.getByRole('button', { name: 'Bold' })).toHaveAttribute(
    'aria-pressed',
    'false',
  )

  await page.keyboard.press('Control+b')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled({
    timeout: 30_000,
  })
  await shot(page, '10-keyboard-bold-saved')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await focusParagraph(reloaded, HEADING)
    await selectFirst(reloaded, 6)
    await expect(
      reloaded.getByRole('button', { name: 'Bold' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await shot(reloaded, '11-keyboard-bold-after-reload')
  } finally {
    await fresh.close()
  }
})
