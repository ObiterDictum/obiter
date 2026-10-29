import { createAccount } from './document-journey'
import { signIn, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import { execFileSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRibbonTab } from './editor-chrome'
import { runMenuCommand } from './editor-chrome'

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
  const main = page.getByRole('main')
  if ((await main.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
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

const paintedHeader = (page: Page) => page.getByText(HEADER_TEXT).first()

const headerParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: 'Header' }).first()

const bodyParagraph = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: BODY_TEXT }).first()

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Review') {
  await openRibbonTab(page, name)
}

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
  const { email, password } = await createAccount(request, 'E7a')
  const matter = `E7a margins ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await expect(paintedHeader(page)).toBeVisible()
  await shot(page, '01-header-painted-readonly')

  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitemcheckbox', { name: 'Header', exact: true })
    .click()
  await expect(
    page.getByRole('menuitemcheckbox', { name: 'Close header' }),
  ).toBeVisible()

  await headerParagraph(page).click()
  await expect(editor(page)).toBeFocused()
  await expect(editor(page)).toHaveValue(new RegExp(HEADER_TEXT))

  await page.keyboard.press('End')
  await page.keyboard.type(` ${MARKER}`)
  await expect(editor(page)).toHaveValue(new RegExp(`${MARKER}$`))
  await shot(page, '02-header-typed')

  await openRibbon(page, 'Insert')
  await page.getByRole('menuitem', { name: 'Page number', exact: true }).click()
  await expect(editor(page)).toHaveValue(new RegExp(`${MARKER}$`))
  await shot(page, '03-page-number-inserted')

  await saveAndWait(page)
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await shot(page, '04-saved')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await expect(reloaded.getByText(MARKER).first()).toBeVisible({
      timeout: 30_000,
    })
    await openRibbon(reloaded, 'Insert')
    await reloaded
      .getByRole('menuitemcheckbox', { name: 'Header', exact: true })
      .click()
    await headerParagraph(reloaded).click()
    await expect(editor(reloaded)).toHaveValue(new RegExp(MARKER))

    await openRibbon(reloaded, 'Insert')
    await reloaded
      .getByRole('menuitemcheckbox', { name: 'Close header' })
      .click()
    await bodyParagraph(reloaded).click()
    await expect(editor(reloaded)).toHaveValue(new RegExp(BODY_TEXT))
    await shot(reloaded, '05-reloaded-body-editable')
  } finally {
    await fresh.close()
  }

  await openRibbon(page, 'Review')
  const downloadPromise = page.waitForEvent('download', { timeout: 20_000 })
  await runMenuCommand(page, 'File', 'Export')
  const download = await downloadPromise
  expect(download.suggestedFilename()).toMatch(/\.docx$/)
  const savedPath = path.join(os.tmpdir(), `e7a-export-${Date.now()}.docx`)
  await download.saveAs(savedPath)
  expectExportedDocx(savedPath)
  await shot(page, '06-exported')
})
