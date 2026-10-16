import { expect, test, type Page } from '@playwright/test'
import path from 'node:path'

/*
 * Browser-only coverage for redo. jsdom can drive the mounted editor and does,
 * in docx-workspace-redo.test.tsx; this journey exists for the parts a real
 * browser decides: focus after a paragraph remount, the platform shortcut
 * reaching the workspace section, and a save followed by a fresh sign-in that
 * reads the stored version back.
 *
 * It needs a synthetic signed-in account and a synthetic DOCX on disk, so it is
 * skipped unless those are supplied:
 *
 *   E6_E2E_EMAIL=... E6_E2E_PASSWORD=... E6_E2E_DOCX=/path/to.docx \
 *   E6_E2E_BASE_URL=http://localhost:3003 bun run --filter @obiter/web \
 *   test:e2e e2e/document-redo.spec.ts --config <lane config>
 *
 * E6_E2E_CAPTURE=1 runs the same stages with soft assertions so the same shots
 * can be taken against a checkout where redo is absent (the Before column).
 * E6_E2E_MATTER names the synthetic matter; give each run its own so the
 * fixture is uploaded fresh and the assertions start from a known document.
 */

const email = process.env.E6_E2E_EMAIL
const password = process.env.E6_E2E_PASSWORD
const fixture = process.env.E6_E2E_DOCX
const shots = process.env.E6_E2E_SHOTS ?? '/tmp/e6-shots'
const matterName = process.env.E6_E2E_MATTER ?? 'E6 Redo Matter'
// Typing coalesces into one history step per burst (document-history-grouping):
// a word boundary ends the run, so this marker is two steps (the space, then
// the word) and two Undo presses remove it.
const textMarker = ' REDO-MARKER'
const ready = Boolean(email && password && fixture)
const capturing = process.env.E6_E2E_CAPTURE === '1'
const check = capturing
  ? expect.configure({ soft: true, timeout: 1_000 })
  : expect

test.use({ viewport: { width: 1440, height: 900 } })

test.skip(!ready, 'set E6_E2E_EMAIL, E6_E2E_PASSWORD and E6_E2E_DOCX to run')

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
async function openFixtureDocument(page: Page, matter = matterName) {
  await signIn(page)

  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matter }).first()
  if ((await matterLink.count()) === 0) {
    await page.getByRole('button', { name: 'Create matter' }).first().click()
    await check(page.getByRole('dialog')).toBeVisible({ timeout: 20_000 })
    await page.getByLabel('Matter name').fill(matter)
    await page.getByLabel('Primary jurisdiction').fill('England & Wales')
    await page
      .getByRole('button', { name: 'Create matter', exact: true })
      .last()
      .click()
    await page.keyboard.press('Escape')
  }
  await page.getByRole('link', { name: matter }).first().click()
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
const redo = (page: Page) =>
  page.getByRole('button', { name: 'Redo', exact: true })
const undo = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })
const paragraph = (page: Page, text: string) =>
  page.locator('[data-paragraph-id]', { hasText: text }).first()

/** Distinct paragraphs rendered, counting a block split across pages once. */
function uniqueParagraphCount(page: Page) {
  return page.$$eval(
    '[data-paragraph-id]',
    (nodes) =>
      new Set(nodes.map((node) => node.getAttribute('data-paragraph-id'))).size,
  )
}

/** Clicks a paragraph until its editor holds the focus. */
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

/** Focuses a paragraph and leaves the caret at the end of its text. */
async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

async function typeInParagraph(page: Page, text: string, marker: string) {
  await caretAtEnd(page, text)
  await page.keyboard.type(marker)
}

/**
 * Clicks a control, skipping it in capture mode when the checkout under test
 * has it disabled: a disabled button is a Before-column result, not a reason
 * for the capture run to stop.
 */
async function clickControl(locator: ReturnType<Page['getByRole']>) {
  if (capturing && (await locator.isDisabled().catch(() => true))) return
  await locator.click()
}

/**
 * Clicks when the control is enabled in either mode, so a stage that the
 * repaired checkout correctly disables does not hang the run.
 */
async function clickIfEnabled(locator: ReturnType<Page['getByRole']>) {
  if (await locator.isDisabled().catch(() => true)) return
  await locator.click()
}

/** Waits for the rendered paragraph count to settle on a value. */
async function waitForParagraphCount(
  page: Page,
  expected: number,
  label: string,
) {
  if (capturing) {
    check(await uniqueParagraphCount(page), label).toBe(expected)
    return
  }
  await expect
    .poll(() => uniqueParagraphCount(page), { message: label })
    .toBe(expected)
}

/** The count once two consecutive reads agree, so a late render is not read mid-flight. */
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

test.describe('redo in a browser', () => {
  test('undo and redo a text edit, then save and reload it', async ({
    page,
    browser,
  }) => {
    await openFixtureDocument(page)

    // No undo has happened, so there is no redo branch yet.
    await check(redo(page)).toBeDisabled()
    await shot(page, '01-redo-disabled-before-any-undo')

    await typeInParagraph(page, 'Paragraph 1.', textMarker)
    await shot(page, '02-text-edited')
    await check(editor(page)).toHaveValue(/REDO-MARKER$/)

    // Two typing runs is two undo steps: the space, then the word.
    await clickControl(undo(page))
    await clickControl(undo(page))
    await shot(page, '03-undo-removed-the-edit')
    await check(editor(page)).not.toHaveValue(/REDO-MARKER/)
    await check(redo(page)).toBeEnabled()

    await clickControl(redo(page))
    await clickControl(redo(page))
    await shot(page, '04-redo-restored-the-edit')
    await check(editor(page)).toHaveValue(/REDO-MARKER$/)
    await check(redo(page)).toBeDisabled()

    // Save, then read the stored version back in a fresh context: only the
    // saved model can produce the marker.
    await clickControl(save(page))
    await check(save(page)).toBeDisabled({ timeout: 30_000 })

    const fresh = await browser.newContext()
    const reloaded = await fresh.newPage()
    try {
      await openFixtureDocument(reloaded)
      await focusParagraph(reloaded, 'Paragraph 1.')
      await check(editor(reloaded)).toHaveValue(/REDO-MARKER$/)
      await shot(reloaded, '05-redone-edit-after-save-and-reload')
    } finally {
      await fresh.close()
    }
  })

  test('steps several edits back and forward', async ({ page }) => {
    await openFixtureDocument(page)

    // Undo is per typing run, not per keystroke: word boundaries break the
    // burst, so 'A B C' is three steps where three plain letters would be one.
    await typeInParagraph(page, 'Paragraph 2.', 'A B C')
    await check(editor(page)).toHaveValue(/A B C$/)

    for (let step = 0; step < 3; step += 1) await clickControl(undo(page))
    await check(editor(page)).not.toHaveValue(/A B C/)
    await shot(page, '06-multiple-undo')

    for (let step = 0; step < 3; step += 1) await clickControl(redo(page))
    await check(editor(page)).toHaveValue(/A B C$/)
    await shot(page, '07-multiple-redo')
    await check(redo(page)).toBeDisabled()
  })

  test('discards the redo branch when a new edit follows an undo', async ({
    page,
  }) => {
    await openFixtureDocument(page)

    await typeInParagraph(page, 'Paragraph 3.', ' OLD')
    await clickControl(undo(page))
    await check(redo(page)).toBeEnabled()

    await typeInParagraph(page, 'Paragraph 3.', ' NEW')
    await check(editor(page)).toHaveValue(/NEW$/)
    await check(redo(page)).toBeDisabled()
    await shot(page, '08-new-edit-cleared-redo')

    // The shortcut is inert once the branch is gone, not just the button.
    await page.keyboard.press('Control+Shift+Z')
    await check(editor(page)).toHaveValue(/NEW$/)
    await check(editor(page)).not.toHaveValue(/OLD/)
  })

  test('restores a split paragraph with its text', async ({ page }) => {
    await openFixtureDocument(page)

    await caretAtEnd(page, 'Paragraph 4.')
    await page.keyboard.press('Enter')
    const pending = page.getByLabel('Pending paragraph text', { exact: true })
    await check(pending).toBeVisible({ timeout: 10_000 })
    // One keystroke is one history step, so a single character keeps the
    // split and the text as two separable redo steps.
    await pending.pressSequentially('S', { delay: 20 })
    await shot(page, '09-split-typed')

    // Undo is per edit: the text rewinds first, the split second.
    await clickControl(undo(page))
    await check(pending).toHaveValue(/^$/)
    await clickControl(undo(page))
    await check(page.getByLabel('Pending paragraph text')).toHaveCount(0)

    await clickControl(redo(page))
    await check(pending).toBeVisible({ timeout: 10_000 })
    await check(pending).toHaveValue(/^$/)
    await shot(page, '10-redo-restored-the-split')
    await clickControl(redo(page))
    await check(pending).toHaveValue(/S$/)
    await shot(page, '11-redo-restored-the-split-text')
  })

  test('restores a formatting edit', async ({ page }) => {
    await openFixtureDocument(page)

    await caretAtEnd(page, 'Paragraph 5.')
    await page.keyboard.press('Home')
    await page.keyboard.press('Shift+ArrowRight')
    await page.keyboard.press('Shift+ArrowRight')
    await page.getByRole('button', { name: 'Bold' }).click()
    const bold = page.getByRole('button', { name: 'Bold' })
    await check(bold).toHaveAttribute('aria-pressed', 'true')
    await shot(page, '12-formatting-applied')

    await clickControl(undo(page))
    await check(bold).toHaveAttribute('aria-pressed', 'false')
    await shot(page, '13-formatting-undone')

    await clickControl(redo(page))
    await check(bold).toHaveAttribute('aria-pressed', 'true')
    await shot(page, '14-formatting-redone')
  })

  test('leaves redo disabled and the shortcut inert with no branch', async ({
    page,
  }) => {
    await openFixtureDocument(page)

    await check(undo(page)).toBeDisabled()
    await check(redo(page)).toBeDisabled()

    const paragraphsBefore = await page.locator('[data-paragraph-id]').count()
    await page.keyboard.press('Control+Shift+Z')
    await page.keyboard.press('Control+y')
    await check(page.locator('[data-paragraph-id]')).toHaveCount(
      paragraphsBefore,
    )

    await typeInParagraph(page, 'Paragraph 6.', ' NEVER-UNDONE')
    await check(editor(page)).toHaveValue(/NEVER-UNDONE$/)
    await check(redo(page)).toBeDisabled()
    await page.keyboard.press('Control+Shift+Z')
    await check(editor(page)).toHaveValue(/NEVER-UNDONE$/)
    await shot(page, '15-redo-disabled-with-no-branch')
  })

  test('does not resave a paragraph a successful save already covered', async ({
    page,
    browser,
  }) => {
    // Its own matter so a previous run's saved insert cannot move the count.
    const matter = `${matterName} duplicate ${String(Date.now())}`
    await openFixtureDocument(page, matter)

    await focusParagraph(page, 'Paragraph 1.')
    const before = await settledParagraphCount(page)

    // Insert a paragraph, then type so Undo has a text step while the insert
    // itself stays in the draft state.
    await page.getByRole('button', { name: 'Insert paragraph' }).click()
    const pending = page.getByLabel('Pending paragraph text', { exact: true })
    await check(pending).toBeVisible({ timeout: 10_000 })
    await pending.pressSequentially('X')
    await clickControl(undo(page))
    await check(pending).toHaveValue(/^$/)

    // Saving covers the insert, which ends the redo branch: a redo would
    // restore the snapshot that still holds it and the next save would insert
    // a second copy.
    await clickControl(save(page))
    await check(save(page)).toBeDisabled({ timeout: 30_000 })
    await check(redo(page)).toBeDisabled({ timeout: 30_000 })
    await shot(page, '16-save-covered-the-insert')
    await clickIfEnabled(redo(page))
    await clickIfEnabled(save(page))
    await check(save(page)).toBeDisabled({ timeout: 30_000 })

    // A fresh context reads the stored version back: exactly one paragraph was
    // added, not two.
    const fresh = await browser.newContext()
    const reloaded = await fresh.newPage()
    try {
      await openFixtureDocument(reloaded, matter)
      await waitForParagraphCount(
        reloaded,
        before + 1,
        'no duplicate paragraph',
      )
      await shot(reloaded, '17-no-duplicate-after-save-redo-save')
    } finally {
      await fresh.close()
    }
  })

  test('moves focus to a surviving paragraph when a redo removes the stored one', async ({
    page,
  }) => {
    await openFixtureDocument(page)
    await focusParagraph(page, 'Paragraph 1.')
    const before = await settledParagraphCount(page)

    // Join 'Paragraph 2.' into 'Paragraph 1.', then undo so the redo deletes
    // the same stored paragraph again.
    await focusParagraph(page, 'Paragraph 2.')
    await page.keyboard.press('Control+Home')
    await page.keyboard.press('Backspace')
    await waitForParagraphCount(
      page,
      before - 1,
      'paragraph removed by the join',
    )
    await clickControl(undo(page))
    await waitForParagraphCount(page, before, 'paragraph restored by undo')

    // Park the caret on the paragraph the redo is about to remove.
    await focusParagraph(page, 'Paragraph 2.')
    await clickControl(redo(page))
    await waitForParagraphCount(
      page,
      before - 1,
      'paragraph removed by the redo',
    )

    // Focus must land on the surviving paragraph, not the body, and the next
    // typed character must go there.
    const surviving = editor(page)
    await check(surviving).toBeFocused()
    await page.keyboard.type('Z')
    await check(surviving).toHaveValue(/Z$/)
    await shot(page, '18-focus-recovered-after-structural-redo')
  })
})
