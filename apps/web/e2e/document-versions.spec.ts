import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { runMenuCommand } from './editor-chrome'
import { expect, test, type Page } from '@playwright/test'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * E10 browser journey: a saved edit creates a second immutable version, the
 * Versions list offers the superseded one for read-only viewing and for a
 * real comparison, and returning to the current version restores the live
 * editor. The account is synthetic and created through the product's own
 * sign-up endpoint; email verification is marked directly in the task-owned
 * test database, never the shared one. The fixture is the repo's synthetic
 * DOCX.
 */

const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
/** Text typed into the current version — the marker the diff must surface. */
const MARKER = 'E10MARK'

function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })

test('versions: edit saves v2, v1 opens read-only, compare shows the change', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E10')
  const matterName = `E10 Matter ${crypto.randomUUID().slice(0, 6)}`
  await openFixtureDocument(page, email, password, matterName, fixturePath())

  // Edit the current version and save — this creates v2 and leaves the
  // uploaded v1 behind as history.
  await focusParagraph(page, HEADING)
  await page.keyboard.press('Home')
  await page.keyboard.type(`${MARKER} `)
  const saveButton = page.getByRole('button', { name: 'Save' })
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  await saveButton.click()
  await expect(saveButton).toBeDisabled({ timeout: 30_000 })

  // A draft typed now and never saved must survive the round-trip into
  // history: the editor unmounts for the read-only view and its persisted
  // per-tab draft restores when the live editor remounts.
  await focusParagraph(page, 'BETWEEN:')
  await page.keyboard.press('End')
  await page.keyboard.type(' DRAFTX')

  // Version history lives in the header's `?` panel (stage 6a), and it now
  // lists v2 as current and v1 as history.
  await page.getByRole('button', { name: 'Document information' }).click()
  const history = page.getByRole('complementary', {
    name: 'Document information',
  })
  const historicalRow = history.locator('li', { hasText: 'Version 1' }).first()
  await expect(historicalRow).toBeVisible({ timeout: 15_000 })
  await expect(historicalRow.getByText('Original upload')).toBeVisible()
  await expect(
    history.getByText('Version 2', { exact: true }).first(),
  ).toBeVisible()

  // Open the historical version: it is read-only — painted pages, no
  // paragraph editor, no Save control — and it shows the pre-edit text.
  await historicalRow.getByRole('button', { name: 'View' }).click()
  await expect(page.getByText('Read only')).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('button', { name: 'Back to current version' }),
  ).toBeVisible()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: HEADING }).first(),
  ).toBeVisible({ timeout: 30_000 })
  // The marker exists only in v2: it must not appear in the v1 view.
  await expect(page.getByText(MARKER)).toHaveCount(0)
  expect(await editor(page).count()).toBe(0)
  expect(await saveButton.count()).toBe(0)

  // Compare v1 (base) against v2 (target) from the live editor: File ▸
  // Compare versions opens the redline, whose picker defaults to exactly that
  // pair, so Compare alone proves the whole document renders with the change
  // marked and its heading states the direction in words.
  await page.getByRole('button', { name: 'Back to current version' }).click()
  await runMenuCommand(page, 'File', 'Compare versions')
  await expect(page.getByText('Comparing versions · read only')).toBeVisible({
    timeout: 15_000,
  })
  await expect(
    page.getByText('Changes from version 1 to version 2'),
  ).toBeVisible()
  await page.getByRole('button', { name: 'Compare', exact: true }).click()
  const comparison = page.locator('[data-compare-redline]')
  await expect(comparison).toBeVisible({ timeout: 30_000 })
  // The whole document, not only the changed paragraph: the untouched
  // heading is there, and so is the edited marker.
  await expect(comparison).toContainText(HEADING)
  await expect(comparison).toContainText(MARKER)
  const differences = page.getByRole('complementary', { name: 'Differences' })
  await expect(differences.getByText('Wording changed')).toBeVisible()
  // Swap keeps its arrow: the direction is a choice, and a bare word beside
  // two version pickers is easy to miss.
  await expect(
    page
      .getByRole('button', { name: 'Swap base and comparison' })
      .locator('svg'),
  ).toHaveCount(1)
  // Beside a docked Differences panel a 1024px window leaves the desk ~390px:
  // the paper shrinks to fit it rather than running under the panel, so no
  // part of the redline is clipped.
  await page.setViewportSize({ width: 1024, height: 768 })
  const desk = await page.locator('[data-document-desk]').boundingBox()
  const sheet = await page.locator('[data-document-sheet]').boundingBox()
  if (!desk || !sheet) throw new Error('the redline did not lay out')
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(desk.x + desk.width + 1)
  await page.setViewportSize({ width: 1280, height: 720 })
  // Close the comparison before returning to the live editor.
  await page.getByRole('button', { name: 'Close comparison' }).click()

  // Back on the current version, the saved edit is painted and the unsaved
  // draft came back with the remounted workspace.
  await expect(
    page.locator('[data-paragraph-id]', { hasText: MARKER }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'DRAFTX' }).first(),
  ).toBeVisible({ timeout: 30_000 })
})
