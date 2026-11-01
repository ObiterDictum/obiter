import { createAccount } from './document-journey'
import { signIn } from './e13-support'
import { expect, test, type Page } from '@playwright/test'

import { createSyntheticDocx } from '../../../packages/ooxml/src/index'
import { closeMenu, menuItem, openMenu, runMenuCommand } from './editor-chrome'

const FIRST = 'E0 sole paragraph of the synthetic fixture.'
const SECOND = 'E0 second paragraph after insertion.'
const FILENAME = 'e0-last-paragraph.docx'

async function openSyntheticDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
  mode: 'upload' | 'reopen',
) {
  await signIn(page, email, password)

  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matterName }).first()
  if ((await matterLink.count()) === 0) {
    await page
      .getByRole('button', { name: /^(New matter|Create the first matter)$/ })
      .first()
      .click()
    await page.getByLabel('Matter name').fill(matterName)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('button', { name: 'Create matter', exact: true })
      .last()
      .click()
    await page
      .getByRole('button', { name: 'Cancel' })
      .click({ timeout: 5_000 })
      .catch(() => undefined)
  }
  await page.getByRole('link', { name: matterName }).first().click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 20_000 })

  const documentRow = page.getByRole('link', { name: FILENAME }).first()
  if (mode === 'upload') {
    const bytes = await createSyntheticDocx([FIRST])
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles({
      name: FILENAME,
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: Buffer.from(bytes),
    })
  }
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
async function deleteButton(page: Page) {
  if (
    !(await page
      .getByRole('menu', { name: 'Edit' })
      .isVisible()
      .catch(() => false))
  ) {
    await openMenu(page, 'Edit')
  }
  return menuItem(page, 'Delete paragraph')
}
const saveButton = (page: Page) => page.getByRole('button', { name: 'Save' })
const undoButton = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const redoButton = (page: Page) =>
  page.getByRole('button', { name: 'Redo', exact: true })

function uniqueParagraphCount(page: Page) {
  return page.$$eval(
    '[data-paragraph-id]',
    (nodes) =>
      new Set(nodes.map((node) => node.getAttribute('data-paragraph-id'))).size,
  )
}

async function settledParagraphCount(page: Page) {
  let previous = -1
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const current = await uniqueParagraphCount(page)
    if (current > 0 && current === previous) return current
    previous = current
    await page.waitForTimeout(100)
  }
  return previous
}

function saveState(page: Page) {
  return page
    .locator('[data-save-state]')
    .first()
    .getAttribute('data-save-state')
}

async function saveAndWait(page: Page) {
  await saveButton(page).click()
  await expect.poll(() => saveState(page), { timeout: 30_000 }).toBe('saved')
}

function watchForFaults(page: Page) {
  const faults: string[] = []
  page.on('pageerror', (error) => faults.push(`pageerror: ${error.message}`))
  page.on('console', (message) => {
    if (message.type() === 'error') faults.push(`console: ${message.text()}`)
  })
  page.on('requestfailed', (request) => {
    const error = request.failure()?.errorText ?? ''
    if (error.includes('ERR_ABORTED')) return
    faults.push(`requestfailed: ${request.url()} ${error}`)
  })
  page.on('response', (response) => {
    if (response.status() >= 500) {
      faults.push(`response ${String(response.status())}: ${response.url()}`)
    }
  })
  return faults
}

test.setTimeout(140_000)

test.use({ viewport: { width: 1440, height: 900 } })

test('final-paragraph deletion is refused, valid deletion saves and reopens', async ({
  page,
  browser,
  request,
}) => {
  const faults = watchForFaults(page)
  const { email, password } = await createAccount(request, 'E0')
  const matter = `E0 ${String(Date.now())}`
  await openSyntheticDocument(page, email, password, matter, 'upload')

  await expect(page.locator('[data-paragraph-id]').first()).toContainText(FIRST)
  const unavailable = await deleteButton(page)
  await expect(unavailable).toBeDisabled()
  await expect(
    page.getByText('A document must contain at least one paragraph.'),
  ).toBeVisible()
  await closeMenu(page)

  await page.locator('[data-paragraph-id]').first().click()
  await expect(editor(page)).toHaveValue(FIRST)
  await page.keyboard.press('Control+Home')
  await page.keyboard.press('Backspace')
  await expect(editor(page)).toHaveValue(FIRST)
  await page.keyboard.press('Control+End')
  await page.keyboard.press('Delete')
  await expect(editor(page)).toHaveValue(FIRST)
  expect(await settledParagraphCount(page)).toBe(1)
  expect(await saveState(page)).not.toBe('unsaved')
  await expect(saveButton(page)).toBeDisabled()

  await runMenuCommand(page, 'Edit', 'Insert paragraph')
  const pending = page.getByLabel('Pending paragraph text', { exact: true })
  await expect(pending).toBeVisible({ timeout: 10_000 })
  await pending.fill(SECOND)
  expect(await settledParagraphCount(page)).toBe(2)
  await expect(await deleteButton(page)).toBeEnabled()
  await saveAndWait(page)
  expect(await settledParagraphCount(page)).toBe(2)

  await page.locator('[data-paragraph-id]').first().click()
  await page.keyboard.press('Control+a')
  await page.keyboard.press('Delete')
  expect(await settledParagraphCount(page)).toBe(1)
  await undoButton(page).click()
  expect(await settledParagraphCount(page)).toBe(2)

  await page.locator('[data-paragraph-id]', { hasText: SECOND }).first().click()
  await (await deleteButton(page)).click()
  expect(await settledParagraphCount(page)).toBe(1)
  await expect(await deleteButton(page)).toBeDisabled()
  await expect(editor(page)).toHaveValue(FIRST)

  await undoButton(page).click()
  expect(await settledParagraphCount(page)).toBe(2)
  await redoButton(page).click()
  expect(await settledParagraphCount(page)).toBe(1)

  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  const freshFaults = watchForFaults(reloaded)
  try {
    await openSyntheticDocument(reloaded, email, password, matter, 'reopen')
    expect(await settledParagraphCount(reloaded)).toBe(1)
    await expect(reloaded.locator('[data-paragraph-id]').first()).toContainText(
      FIRST,
    )
    await expect(await deleteButton(reloaded)).toBeDisabled()
    expect(freshFaults).toEqual([])
  } finally {
    await fresh.close()
  }

  expect(faults).toEqual([])
})
