import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

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
 *   E52_E2E_BASE_URL=http://localhost:3003 pnpm --filter @obiter/web exec \
 *   playwright test e2e/document-selection.spec.ts --config <lane config>
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

test.use({ viewport: { width: 1440, height: 900 } })

test.skip(!ready, 'set E52_E2E_EMAIL, E52_E2E_PASSWORD and E52_E2E_DOCX to run')

function shot(page: Page, name: string) {
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

async function signIn(page: Page) {
  await page.goto('/sign-in', { waitUntil: 'networkidle' })
  // The form is hydrated after load, and a hydration pass can reset a value
  // typed before it; refilling until the values stick is what makes this
  // deterministic.
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
    await page.getByRole('button', { name: 'Continue' }).click()
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

/** Opens the synthetic fixture through the product's own navigation. */
async function openFixtureDocument(page: Page) {
  await signIn(page)

  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matterName }).first()
  if ((await matterLink.count()) === 0) {
    await page.getByRole('button', { name: 'Create matter' }).first().click()
    await expect(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('Matter name').fill(matterName)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('button', { name: 'Create matter', exact: true })
      .last()
      .click()
    await page.keyboard.press('Escape')
  }
  await page.getByRole('link', { name: matterName }).first().click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 20_000 })

  const fixtureName = path.basename(fixture ?? '')
  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(fixture ?? '')
  }
  const documentRow = page.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  // The workspace renders the body without a caret; a paragraph click is what
  // focuses one.
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const status = (page: Page) => page.locator('[data-selection-status]')
const marks = (page: Page) => page.locator('[data-selected-text]')
const paragraph = (page: Page, text: string) =>
  page.locator('[data-paragraph-id]', { hasText: text }).first()

/**
 * Presses a key once the editor that owns the focus has it. A crossing
 * remounts the focused paragraph's textarea, so a press that races the
 * remount would land on the body instead.
 */
async function press(page: Page, key: string) {
  await expect(editor(page)).toBeFocused({ timeout: 10_000 })
  await page.keyboard.press(key)
}

/** Clicks a paragraph until its editor holds the focus. */
async function focusParagraph(page: Page, text: string) {
  const target = paragraph(page, text)
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await expect(editor(page))
      .toBeFocused({ timeout: 4_000 })
      .then(() => true)
      .catch(() => false)
    if (focused) return
  }
  throw new Error(`could not focus the paragraph containing "${text}"`)
}

async function pressMany(page: Page, key: string, times: number) {
  for (let step = 0; step < times; step += 1) await press(page, key)
}

/** Clicks into a paragraph and leaves the caret at a known offset. */
async function caretAfter(page: Page, text: string, offset: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Home')
  await pressMany(page, 'ArrowRight', offset)
}

/** Clicks into a paragraph and jumps the caret to the end of its text. */
async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

test.describe('the document selection in a browser', () => {
  test('extends across paragraphs, keeps its anchor, and collapses', async ({
    page,
  }) => {
    await openFixtureDocument(page)
    // The synthetic fixture parses to four paragraphs, one empty and one with
    // a hard break in it.
    await expect(page.locator('[data-paragraph-id]')).toHaveCount(4)

    const editRequests: string[] = []
    page.on('request', (request) => {
      if (/\/api\/documents\/[^/]+\/edit$/u.test(request.url())) {
        editRequests.push(request.url())
      }
    })

    // From mid-way through the first paragraph, Shift+ArrowDown walks its
    // remaining visual line, the paragraph break, the empty paragraph and into
    // the hard-break paragraph: a selection with text on both sides of the
    // boundary.
    await caretAfter(page, 'Northgate Holdings', 40)
    await pressMany(page, 'Shift+ArrowDown', 3)
    await shot(page, '01-extends-across-a-paragraph-boundary')
    await expect(status(page)).toContainText('3 paragraphs selected')

    // Every paragraph in the body, then contraction from the end.
    await press(page, 'Control+a')
    await shot(page, '02-selection-across-every-paragraph')
    await expect(status(page)).toContainText('4 paragraphs selected')

    await pressMany(page, 'Shift+ArrowLeft', 25)
    await shot(page, '03-backwards-selection-contracting')
    await expect(status(page)).toContainText('paragraphs selected')

    // Ctrl/Alt/Meta modified arrows stay native: with a document selection
    // active they must not move or extend it.
    const beforeModifier = await status(page).textContent()
    await press(page, 'Control+Shift+ArrowLeft')
    await press(page, 'Alt+Shift+ArrowLeft')
    await expect(status(page)).toHaveText(beforeModifier ?? '')

    // Escape leaves a collapsed caret at the focus end and no selection.
    await press(page, 'Escape')
    await shot(page, '04-escape-collapses-at-the-focus-end')
    await expect(status(page)).toBeEmpty()
    await expect(marks(page)).toHaveCount(0)

    // A backwards selection into the paragraph above, in a narrow viewport.
    await caretAtEnd(page, 'Rowan v Aster')
    await pressMany(page, 'Shift+ArrowUp', 2)
    await page.setViewportSize({ width: 480, height: 900 })
    await shot(page, '05-narrow-viewport-selection')
    await expect(status(page)).toContainText('paragraphs selected')
    await page.setViewportSize({ width: 1440, height: 900 })

    // Selecting must not mutate the document or call the edit endpoint.
    expect(editRequests).toEqual([])
    await expect(page.locator('[data-paragraph-id]')).toHaveCount(4)
    await expect(paragraph(page, 'Northgate Holdings')).toContainText(
      'schedule of works',
    )
  })

  test('fails closed on an unsupported action with honest feedback', async ({
    page,
  }) => {
    await openFixtureDocument(page)

    await page.getByRole('tab', { name: 'Review' }).click()
    await page.getByRole('button', { name: 'Track changes off' }).click()
    await page.getByRole('tab', { name: 'Home' }).click()

    // A selection with text in it, so the tracked-change limitation is the
    // one that applies.
    await caretAfter(page, 'Northgate Holdings', 40)
    await pressMany(page, 'Shift+ArrowDown', 3)
    await expect(status(page)).toContainText('3 paragraphs selected')

    const bold = page.getByRole('button', {
      name: 'Bold: Partial formatting is not yet recorded as a tracked change',
    })
    await shot(page, '06-unsupported-formatting-disabled')
    await expect(bold).toBeDisabled()
  })

  test('declines to cross an unsaved inserted paragraph', async ({ page }) => {
    await openFixtureDocument(page)

    await caretAtEnd(page, 'Northgate Holdings')
    await press(page, 'Enter')
    await caretAtEnd(page, 'Northgate Holdings')
    await press(page, 'Shift+ArrowRight')
    await shot(page, '07-inserted-paragraph-blocks-the-selection')
    await expect(status(page)).toContainText(
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

    // A range with text on both sides of two paragraph breaks.
    await caretAfter(page, 'Northgate Holdings', 40)
    await pressMany(page, 'Shift+ArrowDown', 3)
    await shot(page, '08-supported-edit-selection')
    await expect(status(page)).toContainText('3 paragraphs selected')

    await press(page, 'Backspace')
    await shot(page, '09-supported-edit-merged')
    await expect(status(page)).toBeEmpty()
    await expect(editor(page)).toHaveValue(/^Northgate Holdings/)

    await page.getByRole('button', { name: 'Save' }).click()
    await expect(page.getByRole('button', { name: 'Save' })).toBeDisabled({
      timeout: 30_000,
    })
    expect(edited.length).toBeGreaterThan(0)

    // A fresh context with a fresh sign-in reads the stored version back:
    // nothing but the saved model can produce this text.
    const fresh = await browser.newContext()
    const reloaded = await fresh.newPage()
    try {
      await openFixtureDocument(reloaded)
      await paragraph(reloaded, 'Northgate Holdings').click()
      await expect(editor(reloaded)).toHaveValue(/^Northgate Holdings/)
      await expect(editor(reloaded)).not.toHaveValue(/^Rowan v Aster/)
      // The range deleted one paragraph break and merged two paragraphs, so
      // the stored version holds two.
      await expect(reloaded.locator('[data-paragraph-id]')).toHaveCount(2)
      await shot(reloaded, '10-supported-edit-after-reload')
    } finally {
      await fresh.close()
    }
  })
})
