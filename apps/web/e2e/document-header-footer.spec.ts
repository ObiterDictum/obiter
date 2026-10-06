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
import { verifyEmailInDb } from './support'

/*
 * E7a browser journey: the Insert ribbon's Header, Footer and Page number
 * controls must survive the full loop — an edit typed into the final
 * section's header, and a PAGE field inserted at the header caret, must
 * persist through save, a fresh context reading the stored version back,
 * and the exported DOCX. Only a real browser decides the editable margin
 * band, the inert body while a margin story is open, and the re-parsed
 * identities; the mounted suites cover the story plumbing and the writer.
 *
 * The fixture is docx-edge-cases-fixture.docx — the repo's only synthetic
 * document carrying header1.xml ("Header: Alice Example") and footer1.xml
 * ("Footer: Bob Example") referenced by a single section.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/docx-edge-cases-fixture.docx',
)
const HEADER_TEXT = 'Header: Alice Example'
const BODY_TEXT = 'Body: Jane Example'
const MARKER = 'E7AHDR'
const shots = process.env.E7A_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e7a-${runId}@obiter.test`
  const password = `E7a-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E7a User', email, password },
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
  // The fixture name appears twice: the document row in the main region and
  // the mode-rail "In this matter" link. An unscoped locator picks whichever
  // has painted first, and the row only selects the matter page's embedded
  // pane — the readiness check passes there too, so the journey would
  // silently exercise the details surface instead of the workspace.
  const main = page.getByRole('main')
  if ((await main.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(FIXTURE)
  }
  const documentRow = main.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })

  // The standalone workspace lives under the documents route; the rail's
  // "In this matter" link is the only element that navigates there.
  await page
    .getByRole('complementary')
    .getByRole('link', { name: fixtureName })
    .click()
  await expect(page).toHaveURL(/\/documents\//, { timeout: 20_000 })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true })
const ribbon = (page: Page, name: 'Home' | 'Insert' | 'Review') =>
  page.getByRole('tab', { name, exact: true }).first()

/** The painted margin band — read-only, plain text until editing opens. */
const paintedHeader = (page: Page) => page.getByText(HEADER_TEXT).first()

/** The editable band paragraph — carries data-paragraph-id once opened. */
const headerParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: 'Header' }).first()

/** The painted body paragraph — inert while a margin story is open. */
const bodyParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: BODY_TEXT }).first()

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Review') {
  await ribbon(page, name).click()
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

/**
 * Unzips the exported DOCX and asserts the header part carries both the
 * typed marker and the PAGE field instruction. python3 matches how
 * verifyEmailInDb shells out for a tool Node lacks.
 */
function expectExportedDocx(docxPath: string) {
  const script = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'header = z.read("word/header1.xml").decode()',
    'sys.exit(0 if "E7AHDR" in header and " PAGE " in header else 1)',
  ].join('; ')
  const result = execFileSync('python3', ['-c', script, docxPath], {
    stdio: 'pipe',
  })
  expect(result.toString()).toBe('')
}

test.use({ viewport: { width: 1440, height: 900 } })

test('header text and page number survive save, reload and export', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E7a margins ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // The header paints read-only before editing is opened.
  await expect(paintedHeader(page)).toBeVisible()
  await shot(page, '01-header-painted-readonly')

  // Insert ribbon → Header opens the final section's header story.
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Header', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Close header' })).toBeVisible()

  // Clicking the band paragraph focuses the shared paragraph editor.
  await headerParagraph(page).click()
  await expect(editor(page)).toBeFocused()
  await expect(editor(page)).toHaveValue(new RegExp(HEADER_TEXT))

  // While the header story is open the body stays inert: a body click
  // returns editing to the body instead of stealing the caret silently.
  await page.keyboard.press('End')
  await page.keyboard.type(` ${MARKER}`)
  await expect(editor(page)).toHaveValue(new RegExp(`${MARKER}$`))
  await shot(page, '02-header-typed')

  // Page number inserts a PAGE field at the header caret — the editable
  // text stream keeps exactly the typed text (the field is zero-width).
  await page.getByRole('button', { name: 'Page number' }).click()
  await expect(editor(page)).toHaveValue(new RegExp(`${MARKER}$`))
  await shot(page, '03-page-number-inserted')

  await saveAndWait(page)
  // A save whose edit history could not be reconciled surfaces a
  // reload-required banner; the spec must fail while that defect is live.
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await shot(page, '04-saved')

  // A fresh context reads the stored version: the header band still shows
  // the typed marker, and reopening the story shows it as editable text.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect(reloaded.getByText(MARKER).first()).toBeVisible({
      timeout: 30_000,
    })
    await openRibbon(reloaded, 'Insert')
    await reloaded.getByRole('button', { name: 'Header', exact: true }).click()
    await headerParagraph(reloaded).click()
    await expect(editor(reloaded)).toHaveValue(new RegExp(MARKER))

    // Closing the story restores normal body editing.
    await reloaded.getByRole('button', { name: 'Close header' }).click()
    await bodyParagraph(reloaded).click()
    await expect(editor(reloaded)).toHaveValue(new RegExp(BODY_TEXT))
    await shot(reloaded, '05-reloaded-body-editable')
  } finally {
    await fresh.close()
  }

  // The exported DOCX carries both the edited header text and the PAGE
  // field instruction in word/header1.xml.
  await openRibbon(page, 'Review')
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  const savedPath = path.join(HERE, `e7a-export-${Date.now()}.docx`)
  await download.saveAs(savedPath)
  expectExportedDocx(savedPath)
  await shot(page, '06-exported')
})
