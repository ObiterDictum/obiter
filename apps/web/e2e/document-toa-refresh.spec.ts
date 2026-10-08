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
 * E11 browser journey for the table of authorities refresh: the References
 * ribbon's field controls must generate the field's paint, write the stored
 * `TOA` field on save, update the stored field in place — one field, no
 * duplicate `TA` marks — and prove the result in the exported DOCX. Only a
 * real browser decides the pending fold's paint, the ribbon's shared
 * refusal reasons and the re-parse; the mounted suites cover the writer's
 * range replacement and mark deduplication.
 *
 * The fixture is the repo's synthetic demo document: it carries a neutral
 * citation in prose, so the field has an authority to list before the
 * journey adds a second one. The account is synthetic and created through
 * the product's own sign-up endpoint; verification is marked directly in
 * the task-owned test database, never the shared one.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const STORED_CITATION = '[2023] EWHC 1234 (QB)'
const ADDED_CITATION = '[2024] UKSC 3'
const shots = process.env.E11_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e11toa-${runId}@obiter.test`
  const password = `E11toa-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E11 TOA User', email, password },
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
const toaButton = (page: Page) =>
  page.getByRole('button', { name: /Table of authorities/ })
const updateButton = (page: Page) =>
  page.getByRole('button', { name: /Update table/ })
const toaHeading = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: 'Table of Cases' })

async function openReferences(page: Page) {
  await page.getByRole('tab', { name: 'References' }).click()
}

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

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

function zipPart(docxPath: string, partName: string) {
  return execFileSync(
    'python3',
    [
      '-c',
      'import zipfile, sys; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())',
      docxPath,
      partName,
    ],
    { encoding: 'utf-8' },
  )
}

test.use({ viewport: { width: 1440, height: 900 } })

test('table of authorities paints, saves, updates and exports', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E11 authorities ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  // Caret outside every field: the update control is a real refusal, not a
  // silent no-op — the disabled name carries the honest reason.
  await focusParagraph(page, STORED_CITATION)
  await openReferences(page)
  await expect(updateButton(page)).toBeDisabled()

  // The field inserts at the caret: the pending fold paints the heading
  // and the entry the stored citation produces.
  const anchorParagraph = page.locator('[data-paragraph-id]').nth(1)
  await anchorParagraph.click()
  await expect(toaButton(page)).toBeEnabled()
  await toaButton(page).click()
  await expect(toaHeading(page)).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: STORED_CITATION }).first(),
  ).toBeVisible()
  await shot(page, '01-pending-authorities')

  await saveAndWait(page)
  await shot(page, '02-saved-authorities')

  let operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_table_of_authorities' }),
  )

  // Reload: the stored field paints its generated paragraphs, and the
  // update control arms once the caret sits inside the field.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(toaHeading(page)).toHaveCount(1)
  await openReferences(page)
  await focusParagraph(page, 'Table of Cases')
  await expect(updateButton(page)).toBeEnabled()

  // A new citation in an ordinary paragraph, then the refresh: the painted
  // model lists both authorities before the save lands.
  await focusParagraph(page, 'IN THE HIGH COURT OF JUSTICE')
  await page.getByRole('button', { name: 'Insert authority' }).click()
  await page.getByRole('textbox', { name: 'Citation' }).fill(ADDED_CITATION)
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await focusParagraph(page, 'Table of Cases')
  await updateButton(page).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: ADDED_CITATION }).first(),
  ).toBeVisible()
  await shot(page, '03-pending-refresh')

  await saveAndWait(page)
  await shot(page, '04-refreshed')
  operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'update_table_of_authorities' }),
  )

  // The stored answer after reload: one heading, both entries.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(toaHeading(page)).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: STORED_CITATION }).first(),
  ).toBeVisible()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: ADDED_CITATION }).first(),
  ).toBeVisible()
  await shot(page, '05-reloaded-refresh')

  // The exported DOCX proves the write: exactly one `TOA` field, one `TA`
  // mark per citing paragraph — the refresh did not accrete marks — and
  // both entries in the generated result.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exportPath = await download.path()
  const documentXml = zipPart(exportPath, 'word/document.xml')
  expect(documentXml.split(' TOA \\h').length - 1).toBe(1)
  expect(documentXml.split(' TA \\l "').length - 1).toBe(2)
  expect(documentXml).toContain('Table of Cases')
  expect(documentXml).toContain('PAGEREF _ToA')
})
