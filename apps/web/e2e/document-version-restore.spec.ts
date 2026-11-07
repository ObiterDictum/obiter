import { expect, test } from '@playwright/test'
import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { runMenuCommand } from './editor-chrome'
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
  await focusParagraph(page, HEADING)
  await page.keyboard.press('Home')
  await page.keyboard.type('RESTOREMARK ')
  const save = page.getByRole('button', { name: 'Save', exact: true })
  await expect(save).toBeEnabled()
  await save.click()
  await expect(save).toBeDisabled({ timeout: 30_000 })
  await runMenuCommand(page, 'View', 'Document information')
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
    page.getByLabel('Paragraph text', { exact: true }).first(),
  ).not.toContainText('RESTOREMARK')
  await expect(
    page.locator('[data-paragraph-id]', { hasText: HEADING }).first(),
  ).toBeVisible()
  await runMenuCommand(page, 'View', 'Document information')
  await expect(
    information.getByText('Version 3', { exact: true }),
  ).toBeVisible()
  await expect(
    information.locator('li').filter({ hasText: /Version [123]/ }),
  ).toHaveCount(3)
})
