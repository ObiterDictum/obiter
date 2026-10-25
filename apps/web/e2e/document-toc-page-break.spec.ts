import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * E7c regression journey: a save that stores a page break and a table of
 * contents in one batch used to leave the workspace permanently blocked —
 * the history baseline could not translate the snapshot recorded between
 * the two pending insertions, so a typed edit painted but Save stayed
 * disabled and a fresh context silently lost it. Each feature alone
 * dirtied correctly; only the combination failed, which is why the
 * mounted and single-save journeys never saw it. Only a real browser
 * decides the painted fold, the save boundary and the reload; the mounted
 * suite covers the snapshot translation the boundary runs.
 */

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
  page.getByRole('button', { name: /Table of contents/ })
const headingParagraphs = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: HEADING })

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'References') {
  await page.getByRole('tab', { name, exact: true }).first().click()
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

  // Two headings so the field lists real entries, and a page break so the
  // body paginates onto a second sheet.
  await openRibbon(page, 'Home')
  await focusParagraph(page, HEADING)
  await page.getByRole('button', { name: 'Heading 1' }).click()
  await focusParagraph(page, 'Beta paragraph')
  await page.getByRole('button', { name: 'Heading 1' }).click()
  await focusParagraph(page, 'Delta paragraph')
  await openRibbon(page, 'Insert')
  await page.getByRole('button', { name: 'Page break' }).click()

  // Place the field in the first sheet's flow; the break and the field
  // store in one save.
  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await tocButton(page).click()
  await expect(headingParagraphs(page)).toHaveCount(2)
  await saveAndWait(page)
  const sheets = await page.getByLabel('Document page').count()
  expect(sheets).toBeGreaterThan(1)
  await shot(page, '01-saved')

  // The typed edit must dirty the workspace: Save enabled, not a painted
  // value that only lives in the DOM until the next reload.
  const TYPED = 'E7CTYPED'
  await focusParagraph(page, 'Delta paragraph')
  await page.keyboard.press('End')
  await page.keyboard.type(` ${TYPED}`)
  await expect(save(page)).toBeEnabled()
  await shot(page, '02-typed-dirty')
  await saveAndWait(page)

  // A fresh context reads the typed text back alongside the stored field.
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
