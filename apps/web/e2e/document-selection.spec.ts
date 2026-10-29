import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'
import { setTrackChanges } from './editor-chrome'

/*
 * Browser-only coverage for the cross-paragraph selection. Real selection,
 * focus, wrapping and hit testing decide this behaviour, so jsdom cannot drive
 * it: the caret suites cover the geometry and the projection, and this journey
 * covers what a browser does with them.
 *
 * It needs a synthetic signed-in account and a synthetic DOCX on disk, so it
 * is skipped unless those are supplied:
 *
 *   E52_E2E_EMAIL=... E52_E2E_PASSWORD=... E52_E2E_DOCX=/path/to.docx \
 *   E52_E2E_BASE_URL=http://localhost:3003 bun run --filter @obiter/web \
 *   test:e2e e2e/document-selection.spec.ts --config <lane config>
 *
 * The account must be a synthetic user created for the run: the spec signs in
 * with a password and never touches sign-up, verification, magic-link or
 * password-reset. Navigation is client-side because a hard load of a deep
 * route in this dev environment re-renders through the unauthenticated SSR
 * path and lands back on sign-in — a pre-existing behaviour, not this change.
 */

const email = process.env.E52_E2E_EMAIL
const password = process.env.E52_E2E_PASSWORD
const fixture = process.env.E52_E2E_DOCX
const shots = process.env.E52_E2E_SHOTS ?? '/tmp/e52-shots'
const matterName = 'E52 Selection Matter'
const ready = Boolean(email && password && fixture)
const capturing = process.env.E52_E2E_CAPTURE === '1'
const check = capturing
  ? expect.configure({ soft: true, timeout: 1_000 })
  : expect

test.use({ viewport: { width: 1440, height: 900 } })

test.skip(!ready, 'set E52_E2E_EMAIL, E52_E2E_PASSWORD and E52_E2E_DOCX to run')

function shot(page: Page, name: string) {
  if (capturing) console.log('stage', name)
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function signIn(page: Page) {
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByLabel('Email').click()
    await page.getByLabel('Email').pressSequentially(email ?? '', { delay: 10 })
    await page.getByLabel('Password').click()
    await page
      .getByLabel('Password')
      .pressSequentially(password ?? '', { delay: 10 })
    const typed = await expect(page.getByLabel('Email'))
      .toHaveValue(email ?? '', { timeout: 4_000 })
      .then(() => true)
      .catch(() => false)
    if (!typed) {
      await page.reload({ waitUntil: 'networkidle' })
      continue
    }
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    const signedIn = await page
      .waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
        timeout: 15_000,
      })
      .then(() => true)
      .catch(() => false)
    if (signedIn) {
      await page.waitForLoadState('networkidle')
      return
    }
  }
  throw new Error('sign-in did not leave the sign-in route')
}

async function openFixtureDocument(page: Page) {
  await signIn(page)

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
    await check(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('Matter name').fill(matterName)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('button', { name: 'Create matter', exact: true })
      .last()
      .click()
    await page.keyboard.press('Escape')
  }
  await page.getByRole('link', { name: matterName }).first().click()
  await check(page).toHaveURL(/\/matters\//, { timeout: 20_000 })

  const fixtureName = path.basename(fixture ?? '')
  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(fixture ?? '')
  }
  const documentRow = page.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  await check(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const status = (page: Page) => page.locator('[data-selection-status]')
const marks = (page: Page) => page.locator('[data-selected-text]')
const paragraph = (page: Page, text: string) =>
  page.locator('[data-paragraph-id]', { hasText: text }).first()

async function press(page: Page, key: string) {
  await check(editor(page)).toBeFocused()
  await page.keyboard.press(key)
}

async function focusParagraph(page: Page, text: string) {
  const target = paragraph(page, text)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await check(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) return
  }
  if (capturing) return
  throw new Error(`could not focus the paragraph containing "${text}"`)
}

async function pressMany(page: Page, key: string, times: number) {
  for (let step = 0; step < times; step += 1) await press(page, key)
}

async function caretAfter(page: Page, text: string, offset: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Home')
  await pressMany(page, 'ArrowRight', offset)
}

async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

test.describe('the document selection in a browser', () => {
  test('extends across paragraphs, keeps its anchor, and collapses', async ({
    page,
  }) => {
    await openFixtureDocument(page)
    await check(page.locator('[data-paragraph-id]')).toHaveCount(4)

    const editRequests: string[] = []
    page.on('request', (request) => {
      if (/\/api\/documents\/[^/]+\/edit$/u.test(request.url())) {
        editRequests.push(request.url())
      }
    })

    await caretAfter(page, 'Northgate Holdings', 40)
    await pressMany(page, 'Shift+ArrowDown', 3)
    await shot(page, '01-extends-across-a-paragraph-boundary')
    await check(status(page)).toContainText('3 paragraphs selected')

    await press(page, 'Control+a')
    await shot(page, '02-selection-across-every-paragraph')
    await check(status(page)).toContainText('4 paragraphs selected')

    await pressMany(page, 'Shift+ArrowLeft', 25)
    await shot(page, '03-backwards-selection-contracting')
    await check(status(page)).toContainText('paragraphs selected')

    await check(status(page)).toContainText('paragraphs selected')
    await press(page, 'Control+ArrowLeft')
    await check(status(page)).toBeEmpty()
    await check(marks(page)).toHaveCount(0)
    await page.keyboard.type('!')
    await check(editor(page)).toHaveValue(/^!/)
    await check(paragraph(page, 'Northgate Holdings')).toContainText(
      'schedule of works',
    )
    await press(page, 'Backspace')
    await check(editor(page)).toHaveValue(/^Northgate Holdings/)

    await press(page, 'Escape')
    await shot(page, '04-escape-collapses-at-the-focus-end')
    await check(status(page)).toBeEmpty()
    await check(marks(page)).toHaveCount(0)

    await caretAtEnd(page, 'Rowan v Aster')
    await pressMany(page, 'Shift+ArrowUp', 2)
    await page.setViewportSize({ width: 480, height: 900 })
    await shot(page, '05-narrow-viewport-selection')
    await check(status(page)).toContainText('paragraphs selected')
    await page.setViewportSize({ width: 1440, height: 900 })

    expect(editRequests).toEqual([])
    await check(page.locator('[data-paragraph-id]')).toHaveCount(4)
    await check(paragraph(page, 'Northgate Holdings')).toContainText(
      'schedule of works',
    )
  })

  test('fails closed on an unsupported action with honest feedback', async ({
    page,
  }) => {
    await openFixtureDocument(page)

    await setTrackChanges(page, true)

    await caretAfter(page, 'Northgate Holdings', 40)
    await pressMany(page, 'Shift+ArrowDown', 3)
    await check(status(page)).toContainText('3 paragraphs selected')

    const bold = page.getByRole('button', { name: 'Bold', exact: true })
    await expect(bold).toHaveAttribute(
      'title',
      'Partial formatting is not yet recorded as a tracked change',
    )
    await shot(page, '06-unsupported-formatting-disabled')
    await check(bold).toBeDisabled()
  })

  test('declines to cross an unsaved inserted paragraph', async ({ page }) => {
    await openFixtureDocument(page)

    await caretAtEnd(page, 'Northgate Holdings')
    await press(page, 'Enter')
    await caretAtEnd(page, 'Northgate Holdings')
    await press(page, 'Shift+ArrowRight')
    await shot(page, '07-inserted-paragraph-blocks-the-selection')
    await check(status(page)).toContainText(
      'cannot cross an unsaved inserted paragraph',
    )
  })
  test('replaces a cross-paragraph range, saves it and reloads it', async ({
    page,
    browser,
  }) => {
    await openFixtureDocument(page)

    const edited: string[] = []
    page.on('request', (request) => {
      if (/\/api\/documents\/[^/]+\/edit$/u.test(request.url())) {
        edited.push(request.url())
      }
    })

    await caretAfter(page, 'Northgate Holdings', 40)
    await pressMany(page, 'Shift+ArrowDown', 3)
    await shot(page, '08-supported-edit-selection')
    await check(status(page)).toContainText('3 paragraphs selected')

    await press(page, 'Backspace')
    await shot(page, '09-supported-edit-merged')
    await check(status(page)).toBeEmpty()
    await check(editor(page)).toHaveValue(/^Northgate Holdings/)

    await page.getByRole('button', { name: 'Save' }).click()
    await check(page.getByRole('button', { name: 'Save' })).toBeDisabled({
      timeout: 30_000,
    })
    expect(edited.length).toBeGreaterThan(0)

    const fresh = await browser.newContext()
    const reloaded = await fresh.newPage()
    try {
      await openFixtureDocument(reloaded)
      await paragraph(reloaded, 'Northgate Holdings').click()
      await check(editor(reloaded)).toHaveValue(/^Northgate Holdings/)
      await check(editor(reloaded)).not.toHaveValue(/^Rowan v Aster/)
      await check(reloaded.locator('[data-paragraph-id]')).toHaveCount(2)
      await shot(reloaded, '10-supported-edit-after-reload')
    } finally {
      await fresh.close()
    }
  })
})
