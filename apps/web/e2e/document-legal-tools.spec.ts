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

/*
 * E11 browser journey: the References ribbon's legal-document controls must
 * run real editor work — the citation-style choice must shape and persist
 * the inserted authority, the defined-term mark must paint a pending range
 * and write a `mark_defined_term` operation, the checks panel must read the
 * stored `_Def_` bookmark and `REF` fields back, the Insert-authority dialog
 * must refuse unrecognised input before it reaches the document, and the
 * Verify entry must reveal the document-level control rather than start a
 * shadow run. Only a real browser decides the overlay paint, the dialog
 * flow, the panel joins and the localStorage persistence; the mounted
 * suites cover the grammars, the save plan and the writer.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test
 * database, never the shared one. The fixture is the repo's synthetic demo
 * document.
 */

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
/** A command in the Insert menu, which stays open only for its toggles. */
async function insertCommand(page: Page, name: string) {
  await openMenu(page, 'Insert')
  await menuItem(page, name).click()
}
/** A command in the Review menu, where the Checks rows live. */
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

  // The defined-term mark needs a selection; without one the control carries
  // its honest reason and stays disabled rather than faking a no-op success.
  await expect(menuItem(page, 'Mark defined term')).toBeDisabled()

  // The house style is chosen before the insertion so the journey proves the
  // choice shapes what is written, not that a label moved.
  await menuItem(page, 'Citation style: House style').click()
  await closeMenu(page)

  // Insert authority: a caret in a paragraph takes the citation. Free text
  // is refused with an accessible error and reaches neither the document
  // nor the draft state.
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

  // Mark defined term: a selection inside one paragraph takes the pending
  // mark, painted as a range over the covered words.
  await focusHeading(page)
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await openReferences(page)
  await expect(menuItem(page, 'Mark defined term')).toBeEnabled()
  await menuItem(page, 'Mark defined term').click()
  await expect(markedText(page)).toContainText('IN THE')
  await shot(page, '03-pending-mark')

  // The checks panel reads the pending mark now: the term list shows the
  // covered words as a defined term.
  await reviewCommand(page, 'Check defined terms')
  await expect(checksPanel(page)).toBeVisible()
  await expect(checksPanel(page)).toContainText('in the')
  await shot(page, '04-terms-check')

  // The same panel's cross-reference section answers honestly when the
  // document holds no stored fields.
  await reviewCommand(page, 'Check cross-references')
  await expect(checksPanel(page)).toContainText('reference')

  // The list of authorities groups the inserted citation. Verify citations
  // shares the canonical availability, so with pending edits it is disabled
  // with the honest reason rather than starting a run over stale content.
  await reviewCommand(page, 'List of authorities')
  await expect(authoritiesPanel(page)).toContainText(CITATION)
  await openMenu(page, 'Review')
  const verifyButton = menuItem(page, 'Verify citations')
  await expect(verifyButton).toBeDisabled()
  await shot(page, '05-verify-dirty')

  await closeMenu(page)
  await saveAndWait(page)
  await shot(page, '06-saved')

  // Saved, the entry reveals the document-level Verify control: the dock's
  // own button takes focus rather than a second run-starter appearing.
  await openMenu(page, 'Review')
  await expect(verifyButton).toBeEnabled()
  await verifyButton.click()
  await expect(page.getByRole('button', { name: 'Run Verify' })).toBeFocused()
  await shot(page, '07-verify-revealed')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  // The mark and the house style's italic both reach the writer.
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'mark_defined_term' }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'set_run_emphasis', italic: true }),
  )

  // Same-context reload keeps the persisted citation style; the stored
  // document reads the mark and the citation back through the checks.
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

  // A fresh context reads the stored document back: the citation text and
  // the defined-term bookmark survived the save without the draft layer.
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

  // Cancel is honest in both dialogs: the authority dialog forgets its
  // typed citation and the reference chooser forgets its picked target,
  // and neither leaves a pending draft behind — Save stays disabled.
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

  // The same chooser, used for real, paints the pending field marker and
  // writes a REF field whose stored result is the heading's text.
  await insertCommand(page, 'Cross-reference')
  await page
    .getByRole('option', { name: new RegExp(HEADING.slice(0, 20)) })
    .first()
    .click()
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expect(fieldMarkers(page)).toHaveCount(1)
  await saveAndWait(page)

  // Non-empty case: the stored field reads back as checked and clean.
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openReferences(page)
  await reviewCommand(page, 'Check cross-references')
  await expect(checksPanel(page)).toContainText('1 reference field checked')
  await expect(checksPanel(page)).toContainText('No cross-reference findings')
  await shot(page, '11-stored-reference-clean')

  // Stale case: rewriting the target's text leaves the stored result
  // behind, so the next save reports review rather than passing silently.
  // Shift+End selects the single-line heading; Control+A would take the
  // whole document.
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

  // Broken case: deleting the target paragraph removes its bookmark, so
  // the check names the missing target rather than a green panel.
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
