import { expect, test, type Page } from '@playwright/test'
import { createAccount } from './document-journey'
import { caretAtEnd, editor, saveAndWait, signIn } from './e13-support'
import { runCommand } from './editor-chrome'
import { openMatter } from './support'

const text = 'Alpha beta gamma.'
const paragraph = (page: Page) => page.locator('[data-paragraph-id]').first()
const storedDrafts = (page: Page) =>
  page.evaluate(
    () =>
      Object.keys(localStorage).filter((key) =>
        key.startsWith('obiter.document-draft.1.'),
      ).length,
  )

test('saving a restored draft leaves only the next unsaved edit after reopening', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 })
  const { email, password } = await createAccount(page.request, 'DraftReopen')
  await signIn(page, email, password)
  await openMatter(page, 'Draft recovery')
  await page.getByRole('button', { name: 'New document', exact: true }).click()
  await page
    .getByRole('dialog')
    .getByLabel('Name', { exact: true })
    .press('Enter')
  await page
    .getByRole('link', { name: 'Untitled document.docx', exact: true })
    .first()
    .click()
  await expect(page).toHaveURL(/\/documents\//)
  const url = page.url()
  const context = page.context()

  await paragraph(page).click()
  await expect(editor(page)).toBeFocused()
  await page.keyboard.type(text)
  await saveAndWait(page)
  await page.reload()
  await expect(paragraph(page)).toContainText(text)

  await caretAtEnd(page, text)
  await page.keyboard.type('X')
  await saveAndWait(page)
  await page.reload()
  await expect(paragraph(page)).toContainText(text + 'X')

  await caretAtEnd(page, text + 'X')
  await page.keyboard.type('Y')
  await expect.poll(() => storedDrafts(page)).toBe(1)
  await page.close()

  const reopened = await context.newPage()
  await reopened.goto(url)
  await expect(paragraph(reopened)).toContainText(text + 'XY')
  await caretAtEnd(reopened, text + 'XY')
  await reopened.keyboard.press('Control+a')
  await reopened.keyboard.press('Control+b')
  await reopened.keyboard.press('Control+i')
  await saveAndWait(reopened)
  await expect.poll(() => storedDrafts(reopened)).toBe(0)

  await caretAtEnd(reopened, text + 'XY')
  await runCommand(reopened, 'Footnote')
  await expect(editor(reopened)).toHaveValue('')
  await expect.poll(() => storedDrafts(reopened)).toBe(1)
  await reopened.close()

  const finalPage = await context.newPage()
  await finalPage.goto(url)
  await expect(paragraph(finalPage)).toContainText(text + 'XY')
  await expect(finalPage.getByText(/restored from this browser/i)).toBeVisible()
  await expect(
    finalPage.getByText(/More than one unsaved draft exists/i),
  ).toHaveCount(0)
})
