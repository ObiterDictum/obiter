import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import {
  BODY,
  caretAtEnd,
  createAccount,
  EMPTY_DRAFT_STATE,
  openDocx,
  openMatterDocument,
  seedDraft,
} from './e13-support'

test.use({ viewport: { width: 1440, height: 900 } })

test('two abandoned drafts surface the recoverable banner: dialog exits and restore', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E13 recoverable ${Date.now()}`
  await openDocx(page, email, password, matter)

  const siblings: Page[] = []
  for (const suffix of ['E13TABONE', 'E13TABTWO']) {
    const sibling = await page.context().newPage()
    await sibling.goto('/')
    await openMatterDocument(sibling, matter)
    await expect(sibling.locator('[data-paragraph-id]').first()).toBeVisible({
      timeout: 30_000,
    })
    await caretAtEnd(sibling, BODY)
    await sibling.keyboard.type(` ${suffix}`)
    await expect(sibling.getByLabel('Paragraph text')).toHaveValue(
      new RegExp(`${suffix}$`),
    )
    siblings.push(sibling)
  }
  for (const [index, sibling] of siblings.entries()) {
    await expect
      .poll(
        async () =>
          sibling.evaluate(
            () =>
              Object.keys(localStorage).filter((key) =>
                key.startsWith('obiter.document-draft.1.'),
              ).length,
          ),
        { message: `sibling ${index + 1} draft persisted` },
      )
      .toBeGreaterThan(0)
    await sibling.close()
  }

  await page.waitForTimeout(3000)
  await page.reload()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByText(/More than one unsaved draft exists/i),
  ).toBeVisible({ timeout: 30_000 })

  const trigger = page
    .getByRole('button', { name: 'Discard this draft', exact: true })
    .first()
  await trigger.click()
  await page.getByRole('button', { name: 'Cancel', exact: true }).last().click()
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page.getByRole('button', { name: 'Close', exact: true }).last().click()
  await expect(trigger).toBeVisible()
  await trigger.click()
  await page
    .getByRole('button', { name: 'Discard this draft', exact: true })
    .last()
    .click()
  await expect(
    page.getByText(/More than one unsaved draft exists/i),
  ).toBeVisible()
  await expect(trigger).toHaveCount(1)

  await page
    .getByRole('button', { name: /Restore draft from/ })
    .first()
    .click()
  await expect(page.getByText(/restored from this browser/i)).toBeVisible()
  const restored = page.locator('[data-paragraph-id]', {
    hasText: /E13TAB(ONE|TWO)/,
  })
  await expect(restored.first()).toBeVisible({ timeout: 15_000 })
})

test('a draft naming a missing paragraph surfaces the blocked-change discard', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 blocked ${Date.now()}`)

  await seedDraft(page, {
    ...EMPTY_DRAFT_STATE,
    drafts: { 'run-gone': 'orphaned text' },
  })
  await page.reload()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/no longer in the document/i)).toBeVisible({
    timeout: 30_000,
  })

  await page
    .getByRole('button', { name: /Discard \d? ?changes?/, exact: false })
    .first()
    .click()
  await page
    .getByRole('button', { name: /Discard \d? ?changes?/, exact: false })
    .last()
    .click()
  await expect(page.getByText(/no longer in the document/i)).toHaveCount(0)
})

test('a held change restored from an older draft surfaces its discard dialog', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 held ${Date.now()}`)

  await seedDraft(page, EMPTY_DRAFT_STATE, [
    {
      id: 'held-1',
      label: 'a paragraph deletion',
      reason: 'The server refused it.',
      createdAt: new Date().toISOString(),
      state: EMPTY_DRAFT_STATE,
    },
  ])
  await page.reload()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/server rejected .* held here/i)).toBeVisible({
    timeout: 30_000,
  })

  await page
    .getByRole('button', { name: 'Discard held change', exact: true })
    .click()
  await page
    .getByRole('button', { name: 'Discard held change', exact: true })
    .last()
    .click()
  await expect(page.getByText(/server rejected .* held here/i)).toHaveCount(0)
})
