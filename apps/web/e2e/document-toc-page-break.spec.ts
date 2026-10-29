import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  closeMenu,
  menuItem,
  openMenu,
  openRibbonTab,
  runMenuCommand,
} from './editor-chrome'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const HEADING = 'E4 Heading'
const shots = process.env.E7C_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const save = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true })
const tocButton = (page: Page) =>
  page.getByRole('menuitem', { name: 'Table of contents', exact: true })
const headingParagraphs = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: HEADING })

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'References') {
  await openRibbonTab(page, name)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('a typed edit beside a stored table of contents and page break saves and reloads', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E7c')
  const matter = `E7c contents break ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  for (const text of [HEADING, 'Beta paragraph']) {
    await focusParagraph(page, text)
    await openMenu(page, 'Format')
    await menuItem(page, 'Heading 1').click()
    await closeMenu(page)
  }
  await focusParagraph(page, 'Delta paragraph')
  await openRibbon(page, 'Insert')
  await runMenuCommand(page, 'Insert', 'Page break')

  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await tocButton(page).click()
  await expect(headingParagraphs(page)).toHaveCount(2)
  await saveAndWait(page)
  const sheets = await page.getByLabel('Document page').count()
  expect(sheets).toBeGreaterThan(1)
  await shot(page, '01-saved')

  const TYPED = 'E7CTYPED'
  await focusParagraph(page, 'Delta paragraph')
  await page.keyboard.press('End')
  await page.keyboard.type(` ${TYPED}`)
  await expect(save(page)).toBeEnabled()
  await shot(page, '02-typed-dirty')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, FIXTURE)
    await expect(
      reloaded.locator('[data-paragraph-id]', { hasText: TYPED }),
    ).toHaveCount(1, { timeout: 30_000 })
    await expect(headingParagraphs(reloaded)).toHaveCount(2)
    await shot(reloaded, '03-reloaded')
  } finally {
    await fresh.close()
  }
})
