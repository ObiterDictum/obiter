import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { runMenuCommand } from './editor-chrome'
import { expect, test, type Page } from '@playwright/test'

import path from 'node:path'
import { fileURLToPath } from 'node:url'

const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
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

  await focusParagraph(page, HEADING)
  await page.keyboard.press('Home')
  await page.keyboard.type(`${MARKER} `)
  const saveButton = page.getByRole('button', { name: 'Save' })
  await expect(saveButton).toBeEnabled({ timeout: 15_000 })
  await saveButton.click()
  await expect(saveButton).toBeDisabled({ timeout: 30_000 })

  await focusParagraph(page, 'BETWEEN:')
  await page.keyboard.press('End')
  await page.keyboard.type(' DRAFTX')

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

  await historicalRow.getByRole('button', { name: 'View' }).click()
  await expect(page.getByText('Read only')).toBeVisible({ timeout: 15_000 })
  await expect(
    page.getByRole('button', { name: 'Back to current version' }),
  ).toBeVisible()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: HEADING }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText(MARKER)).toHaveCount(0)
  expect(await editor(page).count()).toBe(0)
  expect(await saveButton.count()).toBe(0)

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
  await expect(comparison).toContainText(HEADING)
  await expect(comparison).toContainText(MARKER)
  const differences = page.getByRole('complementary', { name: 'Differences' })
  await expect(differences.getByText('Wording changed')).toBeVisible()
  await expect(
    page
      .getByRole('button', { name: 'Swap base and comparison' })
      .locator('svg'),
  ).toHaveCount(1)
  await page.setViewportSize({ width: 1024, height: 768 })
  const desk = await page.locator('[data-document-desk]').boundingBox()
  const sheet = await page.locator('[data-document-sheet]').boundingBox()
  if (!desk || !sheet) throw new Error('the redline did not lay out')
  expect(sheet.x + sheet.width).toBeLessThanOrEqual(desk.x + desk.width + 1)
  await page.setViewportSize({ width: 1280, height: 720 })
  await page.getByRole('button', { name: 'Close comparison' }).click()

  await expect(
    page.locator('[data-paragraph-id]', { hasText: MARKER }).first(),
  ).toBeVisible({ timeout: 30_000 })
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'DRAFTX' }).first(),
  ).toBeVisible({ timeout: 30_000 })
})
