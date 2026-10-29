import { createAccount, openFixtureDocument } from './document-journey'
import { saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  closeMenu,
  menuItem,
  openFormatting,
  openMenu,
  runMenuCommand,
} from './editor-chrome'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
const CITATION = '[2024] UKSC 3'
const shots = process.env.E11_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true })
async function insertCommand(page: Page, name: string) {
  await openMenu(page, 'Insert')
  await menuItem(page, name).click()
}
async function reviewCommand(page: Page, name: string) {
  await openMenu(page, 'Review')
  await menuItem(page, name).click()
}
const markedText = (page: Page) => page.locator('[data-defined-term]')
const fieldMarkers = (page: Page) => page.locator('[data-field-marker]')
const authoritiesPanel = (page: Page) =>
  page.getByRole('complementary', { name: 'Authorities' })
const checksPanel = (page: Page) =>
  page.getByRole('complementary', { name: 'Legal checks' })

async function openReferences(page: Page) {
  await openMenu(page, 'Insert')
}

async function focusHeading(page: Page) {
  const target = page
    .locator('[data-paragraph-id]', { hasText: HEADING })
    .first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) {
      await page.keyboard.press('Home')
      return
    }
  }
  throw new Error('could not focus the fixture heading')
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('references ribbon legal tools paint, validate, save and persist', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E11')
  const matter = `E11 legal ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await openReferences(page)

  await expect(menuItem(page, 'Mark defined term')).toBeDisabled()

  await menuItem(page, 'Citation style: House style').click()
  await closeMenu(page)

  const caretParagraph = page.locator('[data-paragraph-id]').nth(1)
  await caretParagraph.click()
  await insertCommand(page, 'Insert authority')
  const citationField = page.getByRole('textbox', { name: 'Citation' })
  await citationField.fill('the first defendant')
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expect(page.getByRole('alert')).toBeVisible()
  await shot(page, '01-refused-citation')
  await citationField.fill(CITATION)
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expect(caretParagraph).toContainText(CITATION)
  await shot(page, '02-inserted-authority')

  await focusHeading(page)
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await openReferences(page)
  await expect(menuItem(page, 'Mark defined term')).toBeEnabled()
  await menuItem(page, 'Mark defined term').click()
  await expect(markedText(page)).toContainText('IN THE')
  await shot(page, '03-pending-mark')

  await reviewCommand(page, 'Check defined terms')
  await expect(checksPanel(page)).toBeVisible()
  await expect(checksPanel(page)).toContainText('in the')
  await shot(page, '04-terms-check')

  await reviewCommand(page, 'Check cross-references')
  await expect(checksPanel(page)).toContainText('reference')

  await reviewCommand(page, 'List of authorities')
  await expect(authoritiesPanel(page)).toContainText(CITATION)
  await openMenu(page, 'Review')
  const verifyButton = menuItem(page, 'Verify citations')
  await expect(verifyButton).toBeDisabled()
  await shot(page, '05-verify-dirty')

  await closeMenu(page)
  await saveAndWait(page)
  await shot(page, '06-saved')

  await openMenu(page, 'Review')
  await expect(verifyButton).toBeEnabled()
  await verifyButton.click()
  await expect(page.getByRole('button', { name: 'Run Verify' })).toBeFocused()
  await shot(page, '07-verify-revealed')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'mark_defined_term' }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'set_run_emphasis', italic: true }),
  )

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openReferences(page)
  await expect(menuItem(page, 'Citation style: House style')).toHaveAttribute(
    'aria-checked',
    'true',
  )
  await reviewCommand(page, 'Check defined terms')
  await expect(checksPanel(page)).toContainText('in the', {
    timeout: 30_000,
  })
  await shot(page, '08-reloaded-checks')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, FIXTURE)
    await expect(reloaded.locator('[data-paragraph-id]').nth(1)).toContainText(
      CITATION,
      { timeout: 30_000 },
    )
    await reviewCommand(reloaded, 'Check defined terms')
    await expect(checksPanel(reloaded)).toContainText('in the')
    await shot(reloaded, '09-stored-checks')
  } finally {
    await fresh.close()
  }
})

test('dialogs cancel cleanly and stored reference fields check back', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E11')
  const matter = `E11 references ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  await openReferences(page)

  const caretParagraph = page.locator('[data-paragraph-id]').nth(1)
  await caretParagraph.click()
  await insertCommand(page, 'Insert authority')
  await page.getByRole('textbox', { name: 'Citation' }).fill(CITATION)
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(caretParagraph).not.toContainText(CITATION)
  await expect(save(page)).toBeDisabled()

  await insertCommand(page, 'Cross-reference')
  await page
    .getByRole('option', { name: new RegExp(HEADING.slice(0, 20)) })
    .first()
    .click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(fieldMarkers(page)).toHaveCount(0)
  await expect(save(page)).toBeDisabled()
  await shot(page, '10-cancelled-dialogs')

  await insertCommand(page, 'Cross-reference')
  await page
    .getByRole('option', { name: new RegExp(HEADING.slice(0, 20)) })
    .first()
    .click()
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expect(fieldMarkers(page)).toHaveCount(1)
  await saveAndWait(page)

  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openReferences(page)
  await reviewCommand(page, 'Check cross-references')
  await expect(checksPanel(page)).toContainText('1 reference field checked')
  await expect(checksPanel(page)).toContainText('No cross-reference findings')
  await shot(page, '11-stored-reference-clean')

  await focusHeading(page)
  await page.keyboard.press('Shift+End')
  await page.keyboard.type('Amended heading text')
  await saveAndWait(page)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openReferences(page)
  await reviewCommand(page, 'Check cross-references')
  await expect(checksPanel(page)).toContainText('differs from the target')
  await shot(page, '12-stored-reference-stale')

  await page
    .locator('[data-paragraph-id]', { hasText: 'Amended heading text' })
    .first()
    .click()
  await openFormatting(page)
  await runMenuCommand(page, 'Edit', 'Delete paragraph')
  await saveAndWait(page)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openReferences(page)
  await reviewCommand(page, 'Check cross-references')
  await expect(checksPanel(page)).toContainText(
    'not a bookmark in this document',
  )
  await shot(page, '13-stored-reference-broken')
})
