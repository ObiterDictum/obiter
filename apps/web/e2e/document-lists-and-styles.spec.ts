import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * E4 browser journey: the Styles gallery, multi-paragraph list toggles and
 * list restart must agree end to end. Only a real browser decides the painted
 * list markers, the native selection the custom selection mirrors, and a fresh
 * context reading the stored numbering override back; the mounted suites cover
 * the projection, the save plan and the writer round-trip.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. Two synthetic fixtures are used: one with paragraph
 * styles and numbering, and the repo's style-less fixture for the no-styles
 * state.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const STYLED_FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const PLAIN_FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
// Set to a directory to capture the journey stage by stage; a normal run
// writes nothing.
const shots = process.env.E4_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })

/**
 * Presses a key once the editor that owns the focus has it. A ribbon button
 * click moves DOM focus to the button, so a shortcut pressed straight after
 * one never reaches the textarea.
 */
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

  // Apply a real paragraph style from a chip.
  await focusParagraph(page, 'E4 Heading')
  const quote = page.getByRole('button', { name: 'Quote' })
  await quote.click()
  await expect(quote).toHaveAttribute('aria-pressed', 'true')
  await shot(page, '01-style-applied')

  // A selection spanning paragraphs with different styles is a defined mixed
  // state: no chip is pressed and the select names it instead of one style.
  // Re-focus the editor first: clicking the chip moved focus to the button, so
  // the shortcut would otherwise never reach the textarea.
  await focusParagraph(page, 'E4 Heading')
  await pressKey(page, 'Control+a')
  await expect(page.locator('[data-selection-status]')).toContainText(
    'paragraphs selected',
  )
  await expect(quote).toHaveAttribute('aria-pressed', 'false')
  const styleSelect = page.getByLabel('Paragraph style', { exact: true })
  await expect(styleSelect.locator('option:checked')).toHaveText('Mixed styles')
  await shot(page, '02-style-mixed-selection')

  // One list toggle across a multi-paragraph selection, then a deeper level.
  await focusParagraph(page, 'Beta paragraph')
  await page.keyboard.press('Shift+ArrowDown')
  await page.keyboard.press('Shift+ArrowDown')
  await expect(page.locator('[data-selection-status]')).toContainText(
    'paragraphs selected',
  )
  const multilevel = page.getByRole('button', { name: 'Multilevel numbering' })
  await multilevel.click()
  await expect(multilevel).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('button', { name: 'Increase list indent' }).click()
  await shot(page, '03-list-across-selection')

  // Restart the already-numbered first item at 1.
  await focusParagraph(page, 'Alpha item')
  const restart = page.getByRole('button', { name: 'Restart numbering' })
  await restart.click()
  await expect(restart).toHaveAttribute('aria-pressed', 'true')
  await shot(page, '04-list-restart')

  await saveAndWait(page)
  await shot(page, '05-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'set_paragraph_style', styleId: 'Quote' }),
  )
  // Every paragraph in the selection got its own numbering operation, one at
  // the deeper level.
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

  // A fresh context reads the stored version back: the style, the list level
  // and the restart come only from the saved document.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, STYLED_FIXTURE)
    await focusParagraph(reloaded, 'E4 Heading')
    await expect(
      reloaded.getByRole('button', { name: 'Quote' }),
    ).toHaveAttribute('aria-pressed', 'true')
    await focusParagraph(reloaded, 'Alpha item')
    await expect(
      reloaded.getByRole('button', { name: 'Restart numbering' }),
    ).toHaveAttribute('aria-pressed', 'true')
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

  const select = page.getByLabel(
    'Paragraph style: This document has no paragraph styles.',
  )
  await expect(select).toBeDisabled()
  // The old fallback advertised Normal/Heading 1/Quote as pending UI.
  await expect(page.getByRole('button', { name: /Heading 1/ })).toHaveCount(0)
  await shot(page, '07-no-styles-state')
})
