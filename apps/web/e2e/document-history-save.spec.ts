import { createAccount, openFixtureDocument } from './document-journey'
import { focusParagraph } from './e13-support'
import { expect, test, type Page } from '@playwright/test'

import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { runMenuCommand, setTrackChanges } from './editor-chrome'

/*
 * E50 browser journey: undo across a successful save must persist the reversal
 * exactly once, and a saved structural edit must never be replayed as a fresh
 * insertion. The mounted suites cover the state machine; this journey exists
 * for what only a real browser and a real API decide: the saved model reloading
 * with re-parsed identities, and a fresh context reading the stored version
 * back.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; email verification is marked directly in the task-owned test
 * database, never the shared one. The fixture is the repo's synthetic DOCX.
 */

const FIXTURE_REL = '../../../data/evals/redact/demo-fixture.docx'
/** The fixture's first paragraph; stable across a save. */
const HEADING = 'IN THE HIGH COURT OF JUSTICE'
// Set to a directory to capture the repaired behaviour stage by stage (the PR
// evidence column); a normal run writes nothing.
const shots = process.env.E50_E2E_SHOTS

function shot(page: Page, name: string) {
  if (!shots) return Promise.resolve()
  return page.screenshot({ path: path.join(shots, `${name}.png`) })
}

function fixturePath() {
  const here = path.dirname(fileURLToPath(import.meta.url))
  return path.resolve(here, FIXTURE_REL)
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const save = (page: Page) => page.getByRole('button', { name: 'Save' })
const undo = (page: Page) =>
  page.getByRole('button', { name: 'Undo', exact: true })
const saveState = (page: Page) =>
  page.locator('[data-save-state]').getAttribute('data-save-state')

async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

function uniqueParagraphCount(page: Page) {
  return page.$$eval(
    '[data-paragraph-id]',
    (nodes) =>
      new Set(nodes.map((node) => node.getAttribute('data-paragraph-id'))).size,
  )
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

async function saveAndWait(page: Page) {
  await save(page).click()
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

/** Saves a pending tracked rejection and waits for the decision version. */
async function saveAndWaitForDecision(page: Page) {
  const decision = page.waitForResponse(
    (response) => response.url().includes('/tracked-changes/decision'),
    { timeout: 30_000 },
  )
  await save(page).click()
  await decision
  await expect(save(page)).toBeDisabled({ timeout: 30_000 })
}

async function enableTracking(page: Page) {
  await setTrackChanges(page, true)
}

test.use({ viewport: { width: 1440, height: 900 } })

test('undo after a save persists the reverted text once', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E50')
  const matter = `E50 text ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  await caretAtEnd(page, HEADING)
  await page.keyboard.type(' E50TEXT')
  await expect(editor(page)).toHaveValue(/E50TEXT$/)
  await shot(page, '01-text-typed')
  await saveAndWait(page)
  await shot(page, '02-text-saved')

  // Undo the saved typing against the saved document, then persist it. Typing
  // coalesces into one undo run, so the number of steps is not the character
  // count; undo until the marker is gone (bounded).
  for (let step = 0; step < 12; step += 1) {
    if (!(await editor(page).inputValue()).includes('E50TEXT')) break
    await undo(page).click()
  }
  await expect(editor(page)).not.toHaveValue(/E50TEXT/)
  await shot(page, '03-text-undone-after-save')
  await saveAndWait(page)

  // A fresh context reads the stored version back: the reversal must be what
  // was persisted, not the text the first save wrote.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await focusParagraph(reloaded, HEADING)
    await expect(editor(reloaded)).not.toHaveValue(/E50TEXT/)
    await shot(reloaded, '04-text-reopened-no-marker')
  } finally {
    await fresh.close()
  }
})

test('undo of a saved insert does not persist a duplicate paragraph', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E50')
  const matter = `E50 insert ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  await focusParagraph(page, HEADING)
  const before = await settledParagraphCount(page)

  await runMenuCommand(page, 'Edit', 'Insert paragraph')
  const pending = page.getByLabel('Pending paragraph text', { exact: true })
  await expect(pending).toBeVisible({ timeout: 10_000 })
  // The typed character is one step and the insert itself another, so two
  // undos remove the text and then the insert.
  await pending.pressSequentially('X')
  await shot(page, '05-insert-typed')
  await saveAndWait(page)

  // Undo the typing, then the insert itself: the paragraph is removed against
  // the saved document, not queued for a second insertion.
  await undo(page).click()
  await undo(page).click()
  await expect
    .poll(() => uniqueParagraphCount(page), { message: 'insert undone' })
    .toBe(before)
  await shot(page, '06-insert-undone-after-save')
  await saveAndWait(page)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    // Exactly one paragraph was removed, and the saved insert was not replayed:
    // the count is the original, never before + 1 or before + 2.
    await expect
      .poll(() => uniqueParagraphCount(reloaded), {
        message: 'no duplicate paragraph after save-undo-save',
      })
      .toBe(before)
  } finally {
    await fresh.close()
  }
})

test('undo of a saved tracked edit rejects the change and persists the reversal', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E50')
  const matter = `E50 tracked ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  await enableTracking(page)
  await caretAtEnd(page, HEADING)
  await page.keyboard.type(' TRACKED')
  await expect(editor(page)).toHaveValue(/TRACKED$/)
  await shot(page, '07-tracked-typed')
  await saveAndWait(page)
  await shot(page, '08-tracked-saved')
  // Wait for the save to settle before undoing: an undo that races the in-flight
  // request is a different interaction, and the tracked rejection this test is
  // about needs the translated history.
  await expect
    .poll(() => saveState(page), { message: 'tracked save settled' })
    .toBe('saved')

  // Undo the saved tracked edit; the reversal is a tracked-change rejection.
  // Typing coalesces into undo runs, so undo until the control is exhausted
  // rather than once per character.
  for (let step = 0; step < 12; step += 1) {
    if (await undo(page).isDisabled()) break
    await undo(page).click()
  }
  await shot(page, '09-tracked-undone')
  await saveAndWaitForDecision(page)
  await shot(page, '10-tracked-reversal-saved')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await focusParagraph(reloaded, HEADING)
    await expect(editor(reloaded)).not.toHaveValue(/TRACKED/)
    await shot(reloaded, '11-tracked-reopened-no-marker')
  } finally {
    await fresh.close()
  }
})

test('undo of a saved tracked insertion removes the paragraph atomically', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E50')
  const matter = `E50 tracked insert ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  await enableTracking(page)
  await focusParagraph(page, HEADING)
  const before = await settledParagraphCount(page)

  await runMenuCommand(page, 'Edit', 'Insert paragraph')
  const pending = page.getByLabel('Pending paragraph text', { exact: true })
  await expect(pending).toBeVisible({ timeout: 10_000 })
  await pending.pressSequentially('X')
  await saveAndWait(page)
  // Wait for the tracked save to settle before the undo/redo cycle: a cycle
  // that races the in-flight request is a different interaction.
  await expect
    .poll(() => saveState(page), { message: 'tracked save settled' })
    .toBe('saved')

  // The saved tracked insertion leaves the editor usable: the workspace does
  // not block, and Undo is offered before it is pressed.
  await expect(save(page)).toBeDisabled()
  await expect(undo(page)).toBeEnabled()
  await shot(page, '12-tracked-insert-saved')

  // Undo turns the insertion into one pending decision; Redo cancels it back
  // to the saved state.
  await undo(page).click()
  await expect(save(page)).toBeEnabled()
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(save(page)).toBeDisabled()
  await undo(page).click()
  await expect(save(page)).toBeEnabled()
  await shot(page, '13-tracked-insert-undone')
  // Saving the decision rejects the change and removes the shell in one
  // version, so the rendered paragraph count drops back to the original.
  await saveAndWaitForDecision(page)
  await expect
    .poll(() => uniqueParagraphCount(page), { message: 'shell removed' })
    .toBe(before)

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    // The shell paragraph is gone and no empty paragraph remains.
    await expect.poll(() => uniqueParagraphCount(reloaded)).toBe(before)
    await shot(reloaded, '14-tracked-insert-reopened')
  } finally {
    await fresh.close()
  }
})

test('undo after a reconciled merge save keeps the history usable', async ({
  page,
  browser,
  request,
}) => {
  const { email, password } = await createAccount(request, 'E50')
  const matter = `E50 merge ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter, fixturePath())

  // A colleague commits a newer version first, so this page's save must be
  // reconciled onto it instead of overwriting it.
  const colleagueContext = await browser.newContext()
  const colleague = await colleagueContext.newPage()
  try {
    await openFixtureDocument(colleague, email, password, matter, fixturePath())
    await caretAtEnd(colleague, "KING'S BENCH DIVISION")
    await colleague.keyboard.type('Q')
    await saveAndWait(colleague)
  } finally {
    await colleagueContext.close()
  }

  await caretAtEnd(page, HEADING)
  await page.keyboard.type('Z')
  await saveAndWait(page)
  await expect(page.getByText(/new version to avoid overwriting/)).toBeVisible({
    timeout: 15_000,
  })
  await shot(page, '15-merge-saved')

  // Undo the local typing against the merged document, Redo it, then undo it
  // again and persist. The reconciled merge must not have ended the session.
  await undo(page).click()
  await expect(editor(page)).not.toHaveValue(/Z/)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(editor(page)).toHaveValue(/Z/)
  await undo(page).click()
  await expect(editor(page)).not.toHaveValue(/Z/)
  await saveAndWait(page)
  await shot(page, '16-merge-undone')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, fixturePath())
    await focusParagraph(reloaded, "KING'S BENCH DIVISION")
    await expect(editor(reloaded)).toHaveValue(/Q/)
    await focusParagraph(reloaded, HEADING)
    await expect(editor(reloaded)).not.toHaveValue(/Z/)
    await shot(reloaded, '17-merge-reopened')
  } finally {
    await fresh.close()
  }
})
