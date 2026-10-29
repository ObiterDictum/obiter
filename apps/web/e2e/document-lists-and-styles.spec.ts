import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { closeMenu, menuItem, openFormatting, openMenu } from './editor-chrome'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STYLED_FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const PLAIN_FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const shots = process.env.E4_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })

async function pressKey(page: Page, key: string) {
  await expect(editor(page)).toBeFocused()
  await page.keyboard.press(key)
}

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

type EditBody = { operations?: Array<Record<string, unknown>> }

function isEditBody(value: unknown): value is EditBody {
  return typeof value === 'object' && value !== null && 'operations' in value
}

test.use({ viewport: { width: 1440, height: 900 } })

test('styles, multi-paragraph lists and list restart save and reload', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E4')
  const matter = `E4 lists ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, STYLED_FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  await focusParagraph(page, 'E4 Heading')
  await openMenu(page, 'Format')
  const quote = menuItem(page, 'Quote')
  await quote.click()
  await expect(quote).toHaveAttribute('aria-checked', 'true')
  await closeMenu(page)
  await shot(page, '01-style-applied')

  await focusParagraph(page, 'E4 Heading')
  await pressKey(page, 'Control+a')
  await expect(page.locator('[data-selection-status]')).toContainText(
    'paragraphs selected',
  )
  await openMenu(page, 'Format')
  await expect(menuItem(page, 'Quote')).toHaveAttribute('aria-checked', 'false')
  await closeMenu(page)
  await expect(
    page.getByRole('combobox', { name: 'Paragraph style', exact: true }),
  ).toHaveText('Mixed styles')
  await shot(page, '02-style-mixed-selection')

  await focusParagraph(page, 'Beta paragraph')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('[data-selection-status]')).toContainText(
    'paragraphs selected',
  )
  await openFormatting(page)
  const multilevel = page.getByRole('button', { name: 'Multilevel numbering' })
  await multilevel.click()
  await expect(multilevel).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Increase list indent' }).click()
  await shot(page, '03-list-across-selection')

  await focusParagraph(page, 'Alpha item')
  await openMenu(page, 'Format')
  const restart = menuItem(page, 'Restart numbering')
  await restart.click()
  await expect(restart).toHaveAttribute('aria-checked', 'true')
  await closeMenu(page)
  await shot(page, '04-list-restart')

  await saveAndWait(page)
  await shot(page, '05-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'set_paragraph_style', styleId: 'Quote' }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_paragraph_numbering',
      numId: '1',
      ilvl: 1,
    }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_paragraph_numbering',
      numId: '1',
      ilvl: 0,
      startOverride: 1,
    }),
  )

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, STYLED_FIXTURE)
    await focusParagraph(reloaded, 'E4 Heading')
    await openMenu(reloaded, 'Format')
    await expect(menuItem(reloaded, 'Quote')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await closeMenu(reloaded)
    await focusParagraph(reloaded, 'Alpha item')
    await openMenu(reloaded, 'Format')
    await expect(menuItem(reloaded, 'Restart numbering')).toHaveAttribute(
      'aria-checked',
      'true',
    )
    await closeMenu(reloaded)
    await shot(reloaded, '06-reopened')
  } finally {
    await fresh.close()
  }
})

test('a document with no paragraph styles shows one honest disabled control', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E4')
  const matter = `E4 no styles ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, PLAIN_FIXTURE)

  const select = page.getByRole('combobox', {
    name: 'Paragraph style',
    exact: true,
  })
  await expect(select).toBeDisabled()
  await expect(
    page.getByTitle('This document has no paragraph styles.'),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /Heading 1/ })).toHaveCount(0)
  await shot(page, '07-no-styles-state')
})
