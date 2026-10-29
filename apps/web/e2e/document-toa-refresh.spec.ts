import { verifyEmailInDb } from './support'
import { openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
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
import { openMenu, runMenuCommand } from './editor-chrome'

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

const toaButton = (page: Page) =>
  page.getByRole('menuitem', { name: 'Table of authorities', exact: true })
const updateButton = (page: Page) =>
  page.getByRole('menuitem', {
    name: 'Update table of authorities',
    exact: true,
  })
const toaHeading = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: 'Table of Cases' })

async function openReferences(page: Page) {
  await openMenu(page, 'Insert')
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
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await focusParagraph(page, STORED_CITATION)
  await openReferences(page)
  await expect(updateButton(page)).toBeDisabled()

  const anchorParagraph = page.locator('[data-paragraph-id]').nth(1)
  await anchorParagraph.click()
  await openReferences(page)
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

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(toaHeading(page)).toHaveCount(1)
  await focusParagraph(page, 'Table of Cases')
  await openReferences(page)
  await expect(updateButton(page)).toBeEnabled()

  await focusParagraph(page, 'Table of Cases')
  await openMenu(page, 'Edit')
  const deleteParagraph = page.getByRole('menuitem', {
    name: 'Delete paragraph',
    exact: true,
  })
  await expect(deleteParagraph).toBeDisabled()
  await shot(page, '03-field-boundary-refused')

  await focusParagraph(page, 'IN THE HIGH COURT OF JUSTICE')
  await openReferences(page)
  await page
    .getByRole('menuitem', { name: 'Insert authority', exact: true })
    .click()
  await page.getByRole('textbox', { name: 'Citation' }).fill(ADDED_CITATION)
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await focusParagraph(page, 'Table of Cases')
  await openReferences(page)
  await updateButton(page).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: ADDED_CITATION }).first(),
  ).toBeVisible()
  await shot(page, '04-pending-refresh')

  await saveAndWait(page)
  await shot(page, '05-refreshed')
  operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'update_table_of_authorities' }),
  )

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
  await shot(page, '06-reloaded-refresh')

  const downloadPromise = page.waitForEvent('download')
  await runMenuCommand(page, 'File', 'Export')
  const download = await downloadPromise
  const exportPath = await download.path()
  const documentXml = zipPart(exportPath, 'word/document.xml')
  expect(documentXml.split(' TOA \\h').length - 1).toBe(1)
  expect(documentXml.split(' TA \\l "').length - 1).toBe(2)
  expect(documentXml).toContain('Table of Cases')
  expect(documentXml).toContain('PAGEREF _ToA')
})
