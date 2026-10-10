import { expect, test } from '@playwright/test'
import {
  BODY,
  caretAtEnd,
  createAccount,
  editor,
  openDocx,
  openMatterDocument,
  saveAndWait,
  saveButton,
  saveState,
} from './e13-support'

/*
 * E13 browser coverage, save-state family: the unresolved-lineage reload and
 * the remote-edit conflict reload. Failure states are induced at the network
 * boundary (a rewritten edit response) or through a real sibling-tab save.
 * Shared journey helpers live in e13-support.ts.
 */

test.use({ viewport: { width: 1440, height: 900 } })

test('an edit response without lineage surfaces the unresolved-history reload', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 lineage ${Date.now()}`)

  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E13LINEAGE')
  // The save commits but its lineage is stripped at the network boundary:
  // history cannot be reconciled, so the client must refuse further saves.
  await page.route('**/api/documents/*/edit', async (route) => {
    const response = await route.fetch()
    const body = (await response.json()) as Record<string, unknown>
    delete body['lineage']
    await route.fulfill({ response, json: body })
  })
  await saveButton(page).click()
  await expect
    .poll(() => saveState(page), { message: 'blocked banner' })
    .toBe('blocked')

  await page.unroute('**/api/documents/*/edit')
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await page.getByRole('button', { name: 'Reload', exact: true }).last().click()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  // The irreconcilable history is gone and saving is possible again.
  await expect.poll(() => saveState(page)).not.toBe('blocked')
  await expect(page.getByText('Delta paragraph')).toBeVisible()
})

test('a sibling tab save while dirty surfaces the conflict reload', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E13 conflict ${Date.now()}`
  await openDocx(page, email, password, matter)
  await caretAtEnd(page, BODY)
  await page.keyboard.type(' E13DIRTY')
  await expect(editor(page)).toHaveValue(/E13DIRTY$/)

  const sibling = await page.context().newPage()
  await sibling.goto('/')
  await openMatterDocument(sibling, matter)
  await expect(sibling.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await caretAtEnd(sibling, BODY)
  await sibling.keyboard.type(' E13SAVED')
  await saveAndWait(sibling)
  await sibling.close()

  await expect(
    page.getByText(/colleague saved a newer version|has changed since/i),
  ).toBeVisible({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Reload', exact: true }).click()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText('Delta paragraph E13SAVED')).toBeVisible()
})
