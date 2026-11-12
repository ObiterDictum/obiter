import { expect, test } from '@playwright/test'
import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { runCommand, saveButton } from './editor-chrome'
import { fixturePath } from './support'

const HEADING = 'IN THE HIGH COURT OF JUSTICE'

test('restoring version one creates version three and refreshes current content and History', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'Restore')
  await openFixtureDocument(
    page,
    email,
    password,
    `Restore ${crypto.randomUUID().slice(0, 6)}`,
    fixturePath(),
  )
  const documentId = page.url().split('/').pop()
  const original = await page.request.get(
    `/api/documents/${documentId}/download`,
  )
  expect(original.ok()).toBe(true)
  const originalBytes = await original.body()
  await focusParagraph(page, HEADING)
  await page.keyboard.press('Home')
  await page.keyboard.type('RESTOREMARK ')
  const save = saveButton(page)
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled({ timeout: 30_000 })
  await runCommand(page, 'Document information')
  const information = page.getByRole('complementary', {
    name: 'Document information',
  })
  await information
    .locator('li', { hasText: 'Version 1' })
    .first()
    .getByRole('button', { name: 'View' })
    .click()
  const restore = page
    .getByRole('button', { name: 'Restore this version' })
    .first()
  await expect(restore).toBeVisible()
  await restore.click()
  await expect(page.getByRole('dialog')).toContainText(
    'Obiter saves it as a new version. The current version stays in History.',
  )
  await page
    .getByRole('button', { name: 'Restore version', exact: true })
    .click()
  await expect(
    page
      .getByRole('status')
      .filter({ hasText: 'Version restored as a new current version.' }),
  ).toBeVisible()
  await expect(
    page.getByRole('button', { name: 'Back to current version' }),
  ).toHaveCount(0)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'RESTOREMARK' }),
  ).toHaveCount(0)
  const restored = await page.request.get(
    `/api/documents/${documentId}/download`,
  )
  expect(restored.ok()).toBe(true)
  expect(await restored.body()).toEqual(originalBytes)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: HEADING }).first(),
  ).toBeVisible()
  await runCommand(page, 'Document information')
  await expect(
    information.getByText('Version 3', { exact: true }),
  ).toBeVisible()
  await expect(
    information.locator('li').filter({ hasText: /Version [123]/ }),
  ).toHaveCount(3)
})

test('unsaved work disables restore in History and remains editable after viewing a historical version', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'RestoreDraft')
  await openFixtureDocument(
    page,
    email,
    password,
    `Draft ${crypto.randomUUID().slice(0, 6)}`,
    fixturePath(),
  )
  await focusParagraph(page, HEADING)
  await page.keyboard.press('Home')
  await page.keyboard.type('SAVEDMARK ')
  const save = saveButton(page)
  await save.click()
  await expect(save).toBeDisabled({ timeout: 30_000 })
  await focusParagraph(page, HEADING)
  await page.keyboard.press('End')
  await page.keyboard.type(' UNSAVEDMARK')
  await expect(save).toBeEnabled()
  await runCommand(page, 'Document information')
  await page
    .getByRole('complementary', { name: 'Document information' })
    .locator('li', { hasText: 'Version 1' })
    .first()
    .getByRole('button', { name: 'View' })
    .click()
  const restore = page
    .getByRole('button', { name: 'Restore this version' })
    .first()
  await expect(restore).toBeDisabled()
  await expect(restore).toHaveAttribute(
    'title',
    'Save or discard your changes first.',
  )
  await page.getByRole('button', { name: 'Back to current version' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'UNSAVEDMARK' }).first(),
  ).toBeVisible()
  await expect(save).toBeEnabled()
})
