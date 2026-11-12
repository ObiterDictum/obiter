import { expect, test, type Page } from '@playwright/test'
import { createAccount, openDocx } from './e13-support'
import {
  allCommandsButton,
  appSearchDialog,
  editorCommandPalette,
} from './editor-chrome'

test.use({ viewport: { width: 1440, height: 900 } })

async function openDocument(page: Page) {
  const { email, password } = await createAccount(page.request)
  await openDocx(page, email, password, `Shortcuts ${String(Date.now())}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await page.locator('[data-paragraph-id]').first().click()
}

test('primary+K opens app search from inside a document and leaves the editor palette shut', async ({
  page,
}) => {
  await openDocument(page)

  await page.keyboard.press('ControlOrMeta+k')

  await expect(appSearchDialog(page)).toBeVisible()
  await expect(
    page.getByRole('combobox', { name: 'Search Obiter' }),
  ).toBeFocused()
  await expect(editorCommandPalette(page)).toHaveCount(0)
})

test('primary+Shift+P opens the editor command palette from a paragraph', async ({
  page,
}) => {
  await openDocument(page)

  await page.keyboard.press('ControlOrMeta+Shift+P')

  await expect(editorCommandPalette(page)).toBeVisible()
  await expect(appSearchDialog(page)).toHaveCount(0)
})

test('the All commands button advertises primary+Shift+P in its shortcut and tooltip', async ({
  page,
}) => {
  await openDocument(page)

  const button = allCommandsButton(page)
  await expect(button).toHaveAttribute(
    'aria-keyshortcuts',
    /^(Control|Meta)\+Shift\+P$/u,
  )
  await button.hover()
  await expect(page.getByRole('tooltip')).toContainText(/(⌘⇧P|Ctrl\+Shift\+P)/u)
})
