import { expect, test } from '@playwright/test'
import {
  BODY,
  caretAtEnd,
  createAccount,
  editor,
  openDocx,
  saveAndWait,
} from './e13-support'

for (const viewport of [
  { width: 1440, height: 900 },
  { width: 1024, height: 768 },
]) {
  test(`protects an unstored draft at ${viewport.width}×${viewport.height}`, async ({
    page,
    request,
  }) => {
    await page.setViewportSize(viewport)
    const { email, password } = await createAccount(request)
    await openDocx(
      page,
      email,
      password,
      `Draft storage ${crypto.randomUUID()}`,
    )
    await page.evaluate(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('obiter.document-draft')) {
          throw new DOMException('Storage unavailable', 'QuotaExceededError')
        }
        original.call(this, key, value)
      }
    })
    await caretAtEnd(page, BODY)
    await page.keyboard.type(' QA storage failure')
    await expect(
      page.getByText(/This browser could not store a draft/),
    ).toBeVisible()
    expect(
      await page.evaluate(() => {
        const event = new Event('beforeunload', { cancelable: true })
        window.dispatchEvent(event)
        return event.defaultPrevented
      }),
    ).toBe(true)
    const documentUrl = page.url()
    await page
      .getByRole('link', { name: 'Matters', exact: true })
      .first()
      .click()
    await expect(
      page.getByRole('heading', { name: 'Leave without saving?' }),
    ).toBeVisible()
    expect(page.url()).toBe(documentUrl)
    await page.getByRole('button', { name: 'Stay', exact: true }).click()
    await expect(editor(page)).toHaveValue(/QA storage failure$/)
    await saveAndWait(page)
    await page
      .getByRole('link', { name: 'Matters', exact: true })
      .first()
      .click()
    await expect(
      page.getByRole('heading', { name: 'Matters', exact: true }),
    ).toBeVisible()
    await page.goto(documentUrl, { waitUntil: 'networkidle' })
    await expect(
      page.locator('[data-paragraph-id]', { hasText: 'QA storage failure' }),
    ).toBeVisible()
  })
}
