import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph, saveAndWait } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRibbonTab } from './editor-chrome'
import { closeMenu, openMenu } from './editor-chrome'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const HEADING = 'E4 Heading'
const shots = process.env.E7C_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const tocButton = (page: Page) =>
  page.getByRole('menuitem', { name: 'Table of contents', exact: true })
const headingParagraphs = (page: Page) =>
  page.locator('[data-paragraph-id]', { hasText: HEADING })

async function openRibbon(page: Page, name: 'Home' | 'References') {
  await openRibbonTab(page, name)
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('table of contents refuses without headings, then paints, saves and reloads', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E7c')
  const matter = `E7c contents ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  const refused = tocButton(page)
  await expect(refused).toBeDisabled()
  await expect(
    page.getByText(
      'The document has no headings a table of contents can list.',
    ),
  ).toBeVisible()
  await shot(page, '01-no-headings-refusal')

  await focusParagraph(page, HEADING)
  await openMenu(page, 'Format')
  const headingStyle = page.getByRole('menuitemradio', { name: 'Heading 1' })
  await headingStyle.click()
  await expect(headingStyle).toHaveAttribute('aria-checked', 'true')
  await closeMenu(page)

  await focusParagraph(page, 'Alpha item')
  await openRibbon(page, 'References')
  await expect(tocButton(page)).toBeEnabled()
  await tocButton(page).click()
  await expect(headingParagraphs(page)).toHaveCount(2)
  await expect(headingParagraphs(page).nth(1)).toContainText('1')
  await shot(page, '02-pending-contents')

  await saveAndWait(page)
  await shot(page, '03-saved')

  await focusParagraph(page, 'Alpha item')
  await page.keyboard.press('End')
  await page.keyboard.type(' E7CSECOND')
  await saveAndWait(page)
  await expect(page.getByText('Reloading is required to continue')).toHaveCount(
    0,
  )
  await expect(headingParagraphs(page)).toHaveCount(2)
  await shot(page, '03b-second-save')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_table_of_contents' }),
  )

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, FIXTURE)
    await expect(headingParagraphs(reloaded)).toHaveCount(2, {
      timeout: 30_000,
    })
    await expect(headingParagraphs(reloaded).nth(1)).toContainText('1')
    await shot(reloaded, '04-reloaded')
  } finally {
    await fresh.close()
  }
})
