import { randomUUID } from 'node:crypto'
import {
  test,
  expect,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()

/**
 * The document workspace is where the demo actually happens. These tests seed a
 * real synthetic account, matter and DOCX through the real API and assert the
 * rendered controls: the ribbon entries reveal the one real action, the
 * document-level Redact button is a deliberate size, the review keyboard cannot
 * record a decision from a modified chord, and the 390px layout keeps controls
 * and finalized output inside the viewport.
 */
async function seedDocument(page: Page, request: APIRequestContext) {
  const runId = randomUUID().slice(0, 8)
  const email = `e2e-demo-${runId}@obiter.test`
  const password = `E2e-${runId}-Aa1!`
  const matterName = `E2E Demo Matter ${runId}`

  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E2E Demo User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)

  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  await page.getByLabel('Email').click()
  await page.getByLabel('Email').pressSequentially(email, { delay: 10 })
  await page.getByLabel('Password').click()
  await page.getByLabel('Password').pressSequentially(password, { delay: 10 })
  await page.getByRole('button', { name: 'Continue' }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')

  await page.goto('/matters', { waitUntil: 'networkidle' })
  await page.getByRole('button', { name: 'Create matter' }).first().click()
  await expect(page.getByRole('dialog')).toBeVisible({ timeout: 10_000 })
  await page.getByLabel('Matter name').click()
  await page.getByLabel('Matter name').pressSequentially(matterName, {
    delay: 10,
  })
  await page.getByLabel('Primary jurisdiction').click()
  await page
    .getByLabel('Primary jurisdiction')
    .pressSequentially('England & Wales', { delay: 10 })
  await page
    .getByRole('button', { name: 'Create matter', exact: true })
    .last()
    .click()
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toBeHidden({ timeout: 5_000 })
  await page.getByRole('link', { name: matterName }).first().click()
  await expect(page).toHaveURL(/\/matters\/mtr_/, { timeout: 10_000 })

  const fileInput = page.locator('input[aria-label="Upload document"]')
  await expect(fileInput).toBeAttached({ timeout: 10_000 })
  await fileInput.setInputFiles(fixturePath())
  await expect(page.getByText('demo-fixture.docx').first()).toBeVisible({
    timeout: 20_000,
  })
  await page.getByText('demo-fixture.docx').first().click()
  await expect(page).toHaveURL(/\/matters\/mtr_.*\/documents\/doc_/, {
    timeout: 15_000,
  })
}

test('the ribbon entries reveal the one real document action', async ({
  page,
  request,
}) => {
  await seedDocument(page, request)

  // References ▸ Verify citations is live and moves focus to the dock control.
  await page.getByRole('tab', { name: 'References' }).click()
  const verifyCitations = page.getByRole('button', {
    name: 'Verify citations',
  })
  await expect(verifyCitations).toBeEnabled({ timeout: 15_000 })
  await verifyCitations.click()
  await expect(
    page.getByRole('button', { name: 'Run verification' }),
  ).toBeFocused()

  // Review ▸ Redact this document reveals the real document-level action.
  await page.getByRole('tab', { name: 'Review' }).click()
  const ribbonRedact = page
    .locator('[role="toolbar"]')
    .getByRole('button', { name: 'Redact this document' })
  await expect(ribbonRedact).toBeEnabled()
  await ribbonRedact.click()
  await expect(page.locator('#document-redaction-runs')).toBeFocused()

  // The document-level button is a deliberate size, not a content-wide bar.
  const createRedact = page
    .getByRole('button', { name: 'Redact this document' })
    .last()
  const box = await createRedact.boundingBox()
  expect(box, 'the document-level Redact button has no box').not.toBeNull()
  expect(
    box!.width,
    `the document-level Redact button spans the content column (${box!.width}px)`,
  ).toBeLessThan(400)
})

test('a modified chord cannot record a redaction decision', async ({
  page,
  request,
}) => {
  await seedDocument(page, request)

  // Create the document-linked run through the real action.
  await page.locator('#document-redaction-runs').scrollIntoViewIfNeeded()
  await page
    .getByRole('button', { name: 'Redact this document' })
    .last()
    .click()
  await expect(page).toHaveURL(/\/redact\/red_/, { timeout: 30_000 })
  const listbox = page.locator('[role="listbox"]')
  await expect(listbox).toBeVisible({ timeout: 30_000 })

  // Select the first span so a decision would land on it.
  const firstOption = listbox.getByRole('option').first()
  await firstOption.click()
  await expect(firstOption.getByText('Unreviewed')).toBeVisible()

  // Dispatch the chords as real keydown events on the focused list. A synthetic
  // event proves the handler, without the browser's own reload on Ctrl+R.
  await listbox.evaluate((element) => {
    for (const [key, modifier] of [
      ['k', 'ctrlKey'],
      ['r', 'ctrlKey'],
      ['k', 'metaKey'],
      ['r', 'metaKey'],
    ] as const) {
      element.dispatchEvent(
        new KeyboardEvent('keydown', {
          key,
          [modifier]: true,
          bubbles: true,
          cancelable: true,
        }),
      )
    }
  })

  // The decision is unchanged: the row still reads Unreviewed.
  await expect(firstOption.getByText('Unreviewed')).toBeVisible()

  // Ctrl+K still opens app search, so the fix did not disable it.
  await listbox.focus()
  await listbox.evaluate((element) => {
    element.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'k',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      }),
    )
  })
  await expect(
    page.getByRole('textbox', { name: 'Search Obiter' }),
  ).toBeFocused()
  await expect(firstOption.getByText('Unreviewed')).toBeVisible()

  // The unmodified shortcut still records a decision, so the fix is scoped.
  await listbox.press('r')
  await expect(firstOption.getByText('reject')).toBeVisible({ timeout: 10_000 })
})

test('opening a finding brings its marker inside a 390px viewport', async ({
  page,
  request,
}) => {
  await seedDocument(page, request)

  // Start verification from the document-level control and wait for the run.
  await page.getByRole('button', { name: 'Run verification' }).click()
  await expect(page.getByText('Review required (2)')).toBeVisible({
    timeout: 30_000,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)
  await page.getByRole('button', { name: 'Go to next finding' }).click()

  // The marker layer scrolls the active marker into view, horizontally too, so
  // a finding is reachable on a narrow viewport even though the A4 page is wider.
  await expect
    .poll(
      async () => {
        return page.evaluate(() => {
          const marker = document.querySelector('[data-verification-marker]')
          if (!marker) return null
          const rect = marker.getBoundingClientRect()
          return {
            left: rect.left,
            right: rect.right,
            clientWidth: document.documentElement.clientWidth,
          }
        })
      },
      { timeout: 10_000 },
    )
    .not.toBeNull()

  const marker = await page.evaluate(() => {
    const element = document.querySelector('[data-verification-marker]')
    const rect = element!.getBoundingClientRect()
    return {
      left: rect.left,
      right: rect.right,
      clientWidth: document.documentElement.clientWidth,
    }
  })
  expect(marker.left).toBeGreaterThanOrEqual(-1)
  expect(marker.right).toBeLessThanOrEqual(marker.clientWidth + 1)
})

test('the finalized output and its controls fit a 390px viewport', async ({
  page,
  request,
}) => {
  await seedDocument(page, request)

  await page.locator('#document-redaction-runs').scrollIntoViewIfNeeded()
  await page
    .getByRole('button', { name: 'Redact this document' })
    .last()
    .click()
  await expect(page).toHaveURL(/\/redact\/red_/, { timeout: 30_000 })
  await expect(
    page.getByRole('button', { name: 'Finalize', exact: true }),
  ).toBeVisible({ timeout: 30_000 })

  // Finalize with every acknowledgement the run asks for.
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Finalize redaction output' }),
  ).toBeVisible()
  const acknowledgements = page.getByRole('checkbox')
  for (let index = 0; index < (await acknowledgements.count()); index += 1)
    await acknowledgements.nth(index).check()
  await page.getByRole('button', { name: 'Confirm finalize' }).click()
  await expect(page.getByText('Finalized', { exact: true })).toBeVisible({
    timeout: 30_000,
  })

  await page.setViewportSize({ width: 390, height: 844 })
  await page.waitForTimeout(300)

  const layout = await page.evaluate(() => {
    const doc = document.documentElement
    const output = document.querySelector('[aria-label="Redaction output"]')
    const queue = document.querySelector('[aria-label="Review queue"]')
    const outputRect = output?.getBoundingClientRect()
    const queueRect = queue?.getBoundingClientRect()
    return {
      pageOverflow: doc.scrollWidth - doc.clientWidth,
      outputHeight: outputRect?.height ?? 0,
      outputBottom: outputRect?.bottom ?? 0,
      queueTop: queueRect?.top ?? 0,
    }
  })
  expect(layout.pageOverflow).toBeLessThanOrEqual(0)
  // The queue starts at or below the finalized card: it cannot cover it.
  expect(layout.outputBottom).toBeLessThanOrEqual(layout.queueTop + 1)
  expect(layout.outputHeight).toBeGreaterThan(200)
})
