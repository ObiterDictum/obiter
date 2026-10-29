import { createAccount } from './document-journey'
import { signIn, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRibbonTab } from './editor-chrome'
import { runMenuCommand } from './editor-chrome'

/*
 * E7b browser journey: the Insert ribbon's Footnote control must survive the
 * full loop — a `w:footnoteReference` at the body caret, a new `w:footnote`
 * entry whose body the opened notes story accepts, then save, a fresh
 * context reading the stored version back, and the exported DOCX. Only a
 * real browser decides the folded note body, the open/close contract a
 * painted note body shares with the margin band, and the re-parsed
 * identities; the mounted suites cover the fold, the partition and the
 * writer.
 *
 * The fixture is demo-fixture.docx — it carries no footnotes part, so the
 * journey also exercises `word/footnotes.xml`, its relationship and its
 * content-type override being created on save.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const BODY_TEXT = 'IN THE HIGH COURT OF JUSTICE'
const MARKER = 'E7BNOTE'
const shots = process.env.E7B_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
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

  // The standalone workspace lives under the documents route; the document
  // row itself is the link that opens it. The row's name is ambiguous with
  // the rail's own copy, so the first link wins as it does for the shared
  // journey helper.
  await page.getByRole('link', { name: fixtureName }).first().click()
  await expect(page).toHaveURL(/\/documents\//, { timeout: 20_000 })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })

/** The painted body paragraph the caret anchors in. */
const bodyParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: BODY_TEXT }).first()

/** The painted note body — pending or stored — at the foot of the page. */
const noteParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: MARKER }).first()

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Review') {
  await openRibbonTab(page, name)
}

/**
 * Unzips the exported DOCX and asserts the reference and the note landed:
 * `word/footnotes.xml` carries the typed marker and `word/document.xml`
 * names the reference element. python3 matches how verifyEmailInDb shells
 * out for a tool Node lacks.
 */
function expectExportedDocx(docxPath: string) {
  const script = [
    'import sys, zipfile',
    'z = zipfile.ZipFile(sys.argv[1])',
    'notes = z.read("word/footnotes.xml").decode()',
    'body = z.read("word/document.xml").decode()',
    'sys.exit(0 if "E7BNOTE" in notes and "footnoteReference" in body else 1)',
  ].join('; ')
  const result = execFileSync('python3', ['-c', script, docxPath], {
    stdio: 'pipe',
  })
  expect(result.toString()).toBe('')
}

test.use({ viewport: { width: 1440, height: 900 } })

test('a footnote typed into its opened story survives save, reload and export', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E7b')
  const matter = `E7b footnotes ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // The body caret anchors the reference — retried the way the earlier
  // journeys focus their anchor paragraph.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await bodyParagraph(page).click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) break
    if (attempt === 2) throw new Error('could not focus the body paragraph')
  }
  await page.keyboard.press('End')

  // Insert ribbon → Footnote folds the note in and opens its story: the
  // editable paragraph is the pending note body, empty but for the mark.
  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitemcheckbox', { name: 'Footnote', exact: true })
    .click()
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Close footnotes' }),
  ).toBeVisible()
  // A menu row returns focus to its trigger when the menu closes; the note
  // body is opened and empty, and clicking it lands the caret there.
  await expect(editor(page)).toBeVisible()
  await expect(editor(page)).toHaveValue('')
  await editor(page).click()
  await shot(page, '01-note-story-open')

  await page.keyboard.type(MARKER)
  await expect(editor(page)).toHaveValue(MARKER)
  await shot(page, '02-note-typed')

  await saveAndWait(page)
  // A save whose edit history could not be reconciled surfaces a
  // reload-required banner; the spec must fail while that defect is live.
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await shot(page, '03-saved')

  // The reconciled boundary leaves saving live: close the notes story, edit
  // the body and save again — the unreconciled defect refused this second
  // save behind the reload banner.
  await openRibbon(page, 'Insert')
  await page.getByRole('menuitemcheckbox', { name: 'Close footnotes' }).click()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await bodyParagraph(page).click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) break
    if (attempt === 2) throw new Error('could not refocus the body paragraph')
  }
  await page.keyboard.press('End')
  await page.keyboard.type(' E7BSECOND')
  await expect(editor(page)).toHaveValue(new RegExp('E7BSECOND'))
  await saveAndWait(page)
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await shot(page, '03b-second-save')

  // A fresh context reads the stored version: the painted note body shows
  // the marker, and clicking it opens the story with the text editable —
  // the same open/close contract the margin band keeps.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect(noteParagraph(reloaded)).toBeVisible({ timeout: 30_000 })
    await openRibbon(reloaded, 'Insert')
    await noteParagraph(reloaded).click()
    await openRibbon(reloaded, 'Insert')
    await expect(
      reloaded.getByRole('menuitemcheckbox', { name: 'Close footnotes' }),
    ).toBeVisible()
    await expect(editor(reloaded)).toHaveValue(new RegExp(MARKER))

    // Closing the story restores normal body editing.
    await openRibbon(reloaded, 'Insert')
    await reloaded
      .getByRole('menuitemcheckbox', { name: 'Close footnotes' })
      .click()
    await bodyParagraph(reloaded).click()
    await expect(editor(reloaded)).toHaveValue(new RegExp(BODY_TEXT))
    await shot(reloaded, '04-reloaded-note-editable')
  } finally {
    await fresh.close()
  }

  // The exported DOCX carries both the reference and the note entry.
  await openRibbon(page, 'Review')
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await runMenuCommand(page, 'File', 'Export')
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  const exportDir = mkdtempSync(path.join(tmpdir(), 'e7b-export-'))
  const savedPath = path.join(exportDir, 'footnote.docx')
  await download.saveAs(savedPath)
  expectExportedDocx(savedPath)
  await shot(page, '05-exported')
})
