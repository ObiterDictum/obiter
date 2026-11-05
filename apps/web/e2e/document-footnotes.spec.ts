import { createAccount } from './document-journey'
import { openMatter } from './support'
import { signIn, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRibbonTab } from './editor-chrome'
import { runMenuCommand } from './editor-chrome'

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

  await openMatter(page, matterName)

  const fixtureName = path.basename(FIXTURE)
  const main = page.getByRole('main')
  if ((await main.getByText(fixtureName).count()) === 0) {
    const fileInput = page
      .getByLabel('Upload document', { exact: true })
      .first()
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(FIXTURE)
  }
  const documentRow = main.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })

  await page.getByRole('link', { name: fixtureName }).first().click()
  await expect(page).toHaveURL(/\/documents\//, { timeout: 20_000 })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })

const bodyParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: BODY_TEXT }).first()

const noteParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: MARKER }).first()

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Review') {
  await openRibbonTab(page, name)
}

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

  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitemcheckbox', { name: 'Footnote', exact: true })
    .click()
  await expect(page.getByRole('menu')).toHaveCount(0)
  await expect(editor(page)).toBeVisible()
  await expect(editor(page)).toHaveValue('')
  await expect(editor(page)).toBeFocused()
  await shot(page, '01-note-story-open')

  await page.keyboard.type(MARKER)
  await expect(editor(page)).toHaveValue(MARKER)
  await shot(page, '02-note-typed')

  await saveAndWait(page)
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await shot(page, '03-saved')

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

const CITED = [
  {
    anchor: 'Claim No: REF/2024/0123',
    note: 'E7CITE-A Smith v Jones [2023] EWHC 1234 (KB).',
  },
  { anchor: 'Mrs Sarah Chen (Defendant)', note: 'E7CITE-B CPR r 3.9.' },
  {
    anchor: "KING'S BENCH DIVISION",
    note: 'E7CITE-C Senior Courts Act 1981, s 19.',
  },
] as const

async function focusParagraphEnd(page: Page, text: string) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('[data-paragraph-id]', { hasText: text }).first().click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) break
    if (attempt === 2) throw new Error(`could not focus "${text}"`)
  }
  await page.keyboard.press('End')
}

async function insertCitedFootnote(page: Page, anchor: string, note: string) {
  await focusParagraphEnd(page, anchor)
  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitemcheckbox', { name: 'Footnote', exact: true })
    .click()
  await expect(editor(page)).toBeFocused()
  await page.keyboard.type(note)
  await openRibbon(page, 'Insert')
  await page.getByRole('menuitemcheckbox', { name: 'Close footnotes' }).click()
}

async function numbering(page: Page) {
  const body = await page.locator('[data-note-mark]').allTextContents()
  const notes = (
    await page.locator('[aria-label="Page footnotes"]').allInnerTexts()
  )
    .join(' ')
    .replace(/\s+/gu, ' ')
  return {
    body,
    notes: [...notes.matchAll(/(\d+) E7CITE-([ABC])/gu)].map(
      (match) => `${match[1] ?? ''}${match[2] ?? ''}`,
    ),
  }
}

function exportedNumbering(docxPath: string) {
  const script = [
    'import sys, re, zipfile, json',
    'z = zipfile.ZipFile(sys.argv[1])',
    'body = z.read("word/document.xml").decode()',
    'notes = z.read("word/footnotes.xml").decode()',
    'texts = {i: "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", x)) for i, x in re.findall(r"<w:footnote [^>]*w:id=\\"(\\d+)\\"[^>]*>(.*?)</w:footnote>", notes)}',
    'order = re.findall(r"<w:footnoteReference w:id=\\"(\\d+)\\"/>", body)',
    'cited = [re.search(r"E7CITE-([ABC])", texts.get(i, "")) for i in order]',
    'print(json.dumps({"order": [m.group(1) for m in cited if m], "entries": sorted(re.findall(r"E7CITE-([ABC])", notes)), "superscript": all("<w:vertAlign w:val=\\"superscript\\"/>" in r for r in re.findall(r"<w:r>(?:(?!</w:r>).)*<w:footnoteReference[^>]*/></w:r>", body))}))',
  ].join('\n')
  return JSON.parse(
    execFileSync('python3', ['-c', script, docxPath]).toString(),
  ) as { order: string[]; entries: string[]; superscript: boolean }
}

test('citation footnotes number in document order and renumber after one is deleted, undone, saved and exported', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E7c')
  const matter = `E7c footnotes ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  for (const { anchor, note } of CITED) {
    await insertCitedFootnote(page, anchor, note)
  }
  await expect
    .poll(() => numbering(page))
    .toEqual({ body: ['1', '2', '3'], notes: ['1C', '2A', '3B'] })
  await shot(page, '06-three-citations')

  await focusParagraphEnd(page, 'Claim No: REF/2024/0123')
  for (const _ of 'REF/2024/0123') await page.keyboard.press('Shift+ArrowLeft')
  await page.keyboard.press('Delete')
  await expect(editor(page)).toHaveValue('Claim No: ')
  await expect
    .poll(() => numbering(page))
    .toEqual({ body: ['1', '2'], notes: ['1C', '2B'] })

  await page.keyboard.press('ControlOrMeta+z')
  await expect
    .poll(() => numbering(page))
    .toEqual({ body: ['1', '2', '3'], notes: ['1C', '2A', '3B'] })
  await page.keyboard.press('ControlOrMeta+Shift+z')
  await expect
    .poll(() => numbering(page))
    .toEqual({ body: ['1', '2'], notes: ['1C', '2B'] })
  await shot(page, '07-middle-deleted')

  await saveAndWait(page)
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect
      .poll(() => numbering(reloaded))
      .toEqual({ body: ['1', '2'], notes: ['1C', '2B'] })
  } finally {
    await fresh.close()
  }

  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await runMenuCommand(page, 'File', 'Export')
  const download = await downloadPromise
  const exportDir = mkdtempSync(path.join(tmpdir(), 'e7c-export-'))
  const savedPath = path.join(exportDir, 'citations.docx')
  await download.saveAs(savedPath)
  expect(exportedNumbering(savedPath)).toEqual({
    order: ['C', 'B'],
    entries: ['B', 'C'],
    superscript: true,
  })
})

test('band numbers share their own first line and leave space below the divider', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'NoteLayout')
  await signIn(page, email, password)
  await openMatter(page, `Note layout ${Date.now()}`)
  await page
    .getByLabel('Upload document', { exact: true })
    .first()
    .setInputFiles(path.join(HERE, 'fixtures/note-typography.docx'))
  await page
    .getByRole('link', { name: 'note-typography.docx', exact: true })
    .first()
    .click()
  const band = page.getByLabel('Page footnotes')
  await expect(band).toBeVisible()
  const geometry = await band.evaluate((el) => {
    const rule = el.querySelector('[data-footnote-separator]')
    if (!rule) throw new Error('Missing separator')
    const scale = rule.getBoundingClientRect().height
    return [...el.querySelectorAll('[data-paragraph-id]')].map((p) => {
      const mark = p.querySelector('[aria-label^="Footnote"] span')
      const line = p.querySelector('[data-line-from]')
      if (!mark || !line) throw new Error('Missing note number or line')
      const range = document.createRange()
      range.selectNodeContents(mark)
      const number = range.getBoundingClientRect()
      const text = line.getBoundingClientRect()
      return {
        top: (number.top - text.top) / scale,
        bottom: (number.bottom - text.bottom) / scale,
        gap:
          (Math.min(number.top, text.top) -
            rule.getBoundingClientRect().bottom) /
          scale,
      }
    })
  })
  expect(geometry).toHaveLength(2)
  for (const note of geometry) {
    expect(note.top).toBeGreaterThanOrEqual(-2)
    expect(note.bottom).toBeLessThanOrEqual(1)
    expect(note.gap).toBeGreaterThanOrEqual(5.3)
  }
})
