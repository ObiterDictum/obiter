import { createAccount, openFixtureDocument } from './document-journey'

import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { openRibbonTab } from './editor-chrome'

/*
 * E6b browser journey: the Insert ribbon's Link and Cross-reference controls
 * must paint their pending drafts — a styled range and a zero-width marker —
 * without touching the editable text, then write a real `w:hyperlink` and a
 * real `REF` field on save so a fresh context reads the stored document back.
 * Only a real browser decides the overlay alignment, the chooser, and the
 * re-parse; the mounted suites cover the drafts, the save plan and the
 * writer round-trip.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. The fixture is the repo's synthetic demo document.
 */

const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(
  HERE,
  '../../../data/evals/redact/demo-fixture.docx',
)
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
const LINK_TARGET = 'https://example.com/authority'
const shots = process.env.E6B_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })
const undo = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const linkedText = (page: Page) =>
  page.locator(`[data-link-target="${LINK_TARGET}"]`)
const fieldMarkers = (page: Page) => page.locator('[data-field-marker]')

async function openRibbon(page: Page, name: 'Home' | 'Insert' | 'Layout') {
  await openRibbonTab(page, name)
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
      // A centre-click can land the caret at the paragraph end, from where a
      // shift-extended selection crosses into the next paragraph and the
      // Link control correctly refuses it. Pin the caret to the paragraph
      // start so the selection stays inside one paragraph.
      await page.keyboard.press('Home')
      return
    }
  }
  throw new Error('could not focus the fixture heading')
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

test('hyperlink and cross-reference paint, save and reload', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E6b')
  const matter = `E6b links ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, FIXTURE)

  const editBodies: EditBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/edit$/u.test(outgoing.url())) {
      const body = outgoing.postDataJSON()
      if (isEditBody(body)) editBodies.push(body)
    }
  })

  // A selection inside one paragraph takes the pending hyperlink, painted as
  // a styled range carrying its target.
  await focusHeading(page)
  for (let index = 0; index < 6; index += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await openRibbon(page, 'Insert')
  await page.getByRole('menuitem', { name: 'Link', exact: true }).click()
  await page.getByLabel('Address').fill(LINK_TARGET)
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expect(linkedText(page)).toBeVisible()
  await shot(page, '01-pending-link')

  // A collapsed caret takes the pending cross-reference as a zero-width chip
  // labelled with the target's text — no result text enters the stream. The
  // caret sits in a different paragraph so the reload can tell the stored
  // field result apart from the heading itself.
  await page.keyboard.press('Escape')
  const caretParagraph = page.locator('[data-paragraph-id]').nth(1)
  await caretParagraph.click()
  await openRibbon(page, 'Insert')
  await page
    .getByRole('menuitem', { name: 'Cross-reference', exact: true })
    .click()
  const target = page
    .getByRole('option', { name: new RegExp(HEADING.slice(0, 20)) })
    .first()
  await target.click()
  await page.getByRole('button', { name: 'Insert', exact: true }).last().click()
  await expect(fieldMarkers(page)).toHaveCount(1)
  await shot(page, '02-pending-reference')

  // Undo reverts each pending draft snapshot-first, so both overlays clear.
  // Undo and Redo live on the Home tab; the draft insertions above leave the
  // Insert tab active, where no Undo control exists.
  await openRibbon(page, 'Home')
  await undo(page).click()
  await expect(fieldMarkers(page)).toHaveCount(0)
  await shot(page, '03-undone-reference')
  await page.getByRole('button', { name: 'Redo', exact: true }).click()
  await expect(fieldMarkers(page)).toHaveCount(1)

  await saveAndWait(page)
  await shot(page, '04-saved')

  const operations = editBodies.flatMap((body) => body.operations ?? [])
  expect(operations).toContainEqual(
    expect.objectContaining({
      type: 'set_hyperlink',
      target: LINK_TARGET,
    }),
  )
  expect(operations).toContainEqual(
    expect.objectContaining({ type: 'insert_cross_reference' }),
  )

  // A fresh context reads the stored document back: the field's result is
  // real text now — the heading's words appear where the marker stood.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, FIXTURE)
    await expect(reloaded.locator('[data-paragraph-id]').nth(1)).toContainText(
      HEADING,
      { timeout: 30_000 },
    )
    // The stored w:hyperlink reads back: the linked range repaints with its
    // target rather than falling back to plain text.
    await expect(linkedText(reloaded)).toContainText('IN THE')
    await shot(reloaded, '05-reloaded')
  } finally {
    await fresh.close()
  }
})
