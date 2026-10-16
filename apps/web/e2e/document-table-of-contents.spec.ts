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
 * E7c browser journey: the References ribbon's Table of contents control
 * must refuse honestly while the document holds no heading the field can
 * list, then paint a pending multi-paragraph field — one entry per heading
 * with its `PAGEREF` resolved against the laid-out page — and write the
 * stored `TOC` field on save so a fresh context reads the same entries
 * back. Only a real browser decides the pending fold's paint, the
 * bookmark→page resolution and the re-parse; the mounted suites cover the
 * drafts, the fold, the save plan and the writer round-trip.
 *
 * The fixture carries a `Heading 1` style with no explicit outline level:
 * styling a paragraph exercises the built-in styleId fallback end to end.
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test
 * database, never the shared one.
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

async function openRibbon(page: Page, name: 'Home' | 'References') {
  await page.getByRole('tab', { name, exact: true }).first().click()
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

test('table of contents refuses without headings, then paints, saves and reloads', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7c contents ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  // With no heading the control is a real refusal, not a `soon` chip: the
  // accessible name carries the reason the field cannot be placed. A caret
  // must sit in a paragraph first — before it does, the unanchored reason
  // is the honest one.
  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  const refused = page.getByRole('button', {
    name: 'Table of contents: The document has no headings a table of contents can list.',
  })
  await expect(refused).toBeDisabled()
  await shot(page, '01-no-headings-refusal')

  // Style a paragraph as Heading 1 through the gallery. The style has no
  // explicit outline level — the built-in styleId fallback is what admits
  // it to the field's `\o "1-3"` range.
  await openRibbon(page, 'Home')
  await focusParagraph(page, HEADING)
  const headingStyle = page.getByRole('button', { name: 'Heading 1' })
  await headingStyle.click()
  await expect(headingStyle).toHaveAttribute('aria-pressed', 'true')

  // The caret in an ordinary paragraph takes the pending field: one folded
  // entry paragraph per heading, its `PAGEREF` resolving through the
  // bookmark→page map, the anchor's text unchanged in the editable stream.
  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await expect(tocButton(page)).toBeEnabled()
  await tocButton(page).click()
  await expect(headingParagraphs(page)).toHaveCount(2)
  // The folded entry is the second element carrying the heading's text; its
  // `PAGEREF` paints the heading's page.
  await expect(headingParagraphs(page).nth(1)).toContainText('1')
  await shot(page, '02-pending-contents')

  await saveAndWait(page)
  await shot(page, '03-saved')

  // The journey must still save after writing the field — earlier slices
  // shipped a refused-second-save defect that single-save journeys could
  // not see. Saving is disabled while the workspace is clean, so a small
  // edit gives the second save real work; the stored field must not
  // duplicate its entries.
  await focusParagraph(page, 'Alpha item')
  await page.keyboard.press('End')
  await page.keyboard.type(' E7CSECOND')
  await saveAndWait(page)
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await expect(headingParagraphs(page)).toHaveCount(2)
  await shot(page, '03b-second-save')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_table_of_contents' }),
  )

  // A fresh context reads the stored field back: the generated entry
  // paragraph and its resolved page number are real document content now.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect(headingParagraphs(reloaded)).toHaveCount(2, {
      timeout: 30_000,
    })
    await expect(headingParagraphs(reloaded).nth(1)).toContainText('1')
    await shot(reloaded, '04-reloaded')
  } finally {
    await fresh.close()
  }
})
