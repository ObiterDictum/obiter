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

test.use({ viewport: { width: 1440, height: 900 } })

test('cut warns about the removed footnote and Undo restores it before save and export', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'CutNote')
  await openFixtureDocument(page, email, password, `Cut note ${Date.now()}`)
  await bodyParagraph(page).click()
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press('End')
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Footnote', exact: true }).click()
  await page.keyboard.type(MARKER)
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Close footnotes' }).click()
  await saveAndWait(page)
  await bodyParagraph(page).click()
  await expect(editor(page)).toBeFocused()
  const directory = process.env.CUT_NOTE_SHOTS
  if (directory)
    await page.screenshot({ path: path.join(directory, 'before-cut.png') })
  await page.keyboard.press('Home')
  await page.keyboard.press('Shift+End')
  await page.keyboard.press('ControlOrMeta+x')
  await expect(
    page.getByText(
      '1 footnote was removed by the cut. Undo restores it. Pasting brings back only the text.',
      { exact: true },
    ),
  ).toBeVisible()
  if (directory) {
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 })
      for (const colorScheme of ['light', 'dark'] as const) {
        const toggle = page.getByRole('button', {
          name: `Switch to ${colorScheme} theme`,
        })
        if (await toggle.count()) await toggle.click()
        await page
          .getByText(
            '1 footnote was removed by the cut. Undo restores it. Pasting brings back only the text.',
            { exact: true },
          )
          .scrollIntoViewIfNeeded()
        await page.screenshot({
          path: path.join(directory, `after-${width}-${colorScheme}.png`),
        })
      }
    }
    await page.setViewportSize({ width: 1440, height: 900 })
  }
  await runMenuCommand(page, 'Edit', 'Undo')
  await expect(page.locator('[data-note-mark]')).toHaveCount(1)
  await expect(
    page.getByRole('button', { name: 'Save', exact: true }),
  ).toBeDisabled()
  await page.reload()
  await expect(noteParagraph(page)).toBeVisible()
  const downloadPromise = page.waitForEvent('download')
  await runMenuCommand(page, 'File', 'Export')
  const download = await downloadPromise
  const exported = path.join(
    mkdtempSync(path.join(tmpdir(), 'cut-note-')),
    'restored.docx',
  )
  await download.saveAs(exported)
  execFileSync('python3', [
    '-c',
    'import sys, zipfile; assert zipfile.ZipFile(sys.argv[1]).read("word/footnotes.xml").decode().count("E7BNOTE")==1',
    exported,
  ])
})
