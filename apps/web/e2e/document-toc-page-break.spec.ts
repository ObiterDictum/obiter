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
 * E7c regression journey: a save that stores a page break and a table of
 * contents in one batch used to leave the workspace permanently blocked —
 * the history baseline could not translate the snapshot recorded between
 * the two pending insertions, so a typed edit painted but Save stayed
 * disabled and a fresh context silently lost it. Each feature alone
 * dirtied correctly; only the combination failed, which is why the
 * mounted and single-save journeys never saw it. Only a real browser
 * decides the painted fold, the save boundary and the reload; the mounted
 * suite covers the snapshot translation the boundary runs.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const HEADING = 'E4 Heading'
const shots = process.env.E7C_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e7c-${runId}@obiter.test`
  const password = `E7c-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E7c User', email, password },
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
const tocButton = (page: Page) =>
  page.getByRole('button', { name: /Table of contents/ })
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

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'References') {
  await page.getByRole('tab', { name, exact: true }).first().click()
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

test.use({ viewport: { width: 1440, height: 900 } })

test('a typed edit beside a stored table of contents and page break saves and reloads', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7c contents break ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // Two headings so the field lists real entries, and a page break so the
  // body paginates onto a second sheet.
  await openRibbon(page, 'Home')
  await focusParagraph(page, HEADING)
  await page.getByRole('button', { name: 'Heading 1' }).click()
  await focusParagraph(page, 'Beta paragraph')
  await page.getByRole('button', { name: 'Heading 1' }).click()
  await focusParagraph(page, 'Delta paragraph')
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Page break' }).click()

  // Place the field in the first sheet's flow; the break and the field
  // store in one save.
  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await tocButton(page).click()
  await expect(headingParagraphs(page)).toHaveCount(2)
  await saveAndWait(page)
  const sheets = await page.getByLabel('Document page').count()
  expect(sheets).toBeGreaterThan(1)
  await shot(page, '01-saved')

  // The typed edit must dirty the workspace: Save enabled, not a painted
  // value that only lives in the DOM until the next reload.
  const TYPED = 'E7CTYPED'
  await focusParagraph(page, 'Delta paragraph')
  await page.keyboard.press('End')
  await page.keyboard.type(` ${TYPED}`)
  await expect(save(page)).toBeEnabled()
  await shot(page, '02-typed-dirty')
  await saveAndWait(page)

  // A fresh context reads the typed text back alongside the stored field.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect(
      reloaded.locator('[data-paragraph-id]', { hasText: TYPED }),
    ).toHaveCount(1, { timeout: 30_000 })
    await expect(headingParagraphs(reloaded)).toHaveCount(2)
    await shot(reloaded, '03-reloaded')
  } finally {
    await fresh.close()
  }
})
