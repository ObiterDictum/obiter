import { expect, test } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { openMatter } from './support'

test('a new document takes the name chosen in the dialog, and Escape cancels', async ({
  page,
}) => {
  const { email, password } = await createAccount(page.request, 'DocName')
  await signIn(page, email, password)
  await openMatter(page, `Naming ${crypto.randomUUID()}`)
  const newDocument = page.getByRole('button', {
    name: 'New document',
    exact: true,
  })

  await newDocument.click()
  const name = page.getByRole('dialog').getByLabel('Name', { exact: true })
  await expect(name).toBeFocused()
  await expect(name).toHaveValue('Untitled document')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(page.getByRole('link', { name: /^Untitled/ })).toHaveCount(0)

  await newDocument.click()
  await page.keyboard.type('Witness statement')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    page
      .getByRole('table')
      .getByRole('link', { name: 'Witness statement.docx', exact: true }),
  ).toBeVisible()
})
