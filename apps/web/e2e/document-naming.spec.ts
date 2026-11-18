import { expect, test } from '@playwright/test'
import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { popupMenus } from './editor-chrome'
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

test('a document is renamed from the matter list and from the workspace title', async ({
  page,
}) => {
  const { email, password } = await createAccount(page.request, 'DocRename')
  await signIn(page, email, password)
  await openMatter(page, `Renaming ${crypto.randomUUID()}`)
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await page.keyboard.type('First draft')
  await page.keyboard.press('Enter')
  const table = page.getByRole('table')
  await expect(
    table.getByRole('link', { name: 'First draft.docx', exact: true }),
  ).toBeVisible()

  await table
    .getByRole('button', { name: 'Actions for First draft.docx' })
    .click()
  await popupMenus(page).getByText('Rename…', { exact: true }).click()
  const dialogName = page
    .getByRole('dialog')
    .getByLabel('Name', { exact: true })
  await expect(dialogName).toBeFocused()
  await expect(dialogName).toHaveValue('First draft')
  await page.keyboard.type('Skeleton argument')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(
    table.getByRole('link', { name: 'Skeleton argument.docx', exact: true }),
  ).toBeVisible()
  await expect(
    table.getByRole('link', { name: 'First draft.docx', exact: true }),
  ).toHaveCount(0)

  await table
    .getByRole('link', { name: 'Skeleton argument.docx', exact: true })
    .click()
  const title = page.getByRole('heading', {
    level: 1,
    name: 'Skeleton argument.docx',
  })
  await expect(title).toBeVisible()
  await title.getByRole('button').focus()
  await page.keyboard.press('F2')
  const titleInput = page.getByLabel('Document name', { exact: true })
  await expect(titleInput).toBeFocused()
  await expect(titleInput).toHaveValue('Skeleton argument')
  await page.keyboard.type('drafts/argument')
  await page.keyboard.press('Enter')
  await expect(page.getByRole('alert')).toHaveText(
    'Names cannot contain slashes or control characters.',
  )
  await page.keyboard.press('Escape')
  await expect(title).toBeVisible()

  await title.getByRole('button').click()
  await page.keyboard.type('Skeleton argument (final)')
  await page.keyboard.press('Enter')
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Skeleton argument (final).docx',
    }),
  ).toBeVisible()
  await page.reload()
  await expect(
    page.getByRole('heading', {
      level: 1,
      name: 'Skeleton argument (final).docx',
    }),
  ).toBeVisible()
})
