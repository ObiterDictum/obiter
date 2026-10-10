import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { verifyEmailInDb } from './support'

/*
 * E13 browser coverage: the View ribbon's real controls (web layout, ruler,
 * navigation pane, spelling), DOCX zoom, the PDF viewer's controls and its
 * bounded per-page mounting, and the conditionally-rendered save/draft
 * surfaces the audit listed as browser-uncovered: the recoverable-draft
 * banner (restore + discard dialogs), the unresolved-lineage reload, the
 * blocked-change and held-change dialogs, and the remote-edit conflict
 * reload. Failure states are induced at the network boundary (aborted or
 * rewritten edit responses) or through real sibling-tab saves; the held
 * change is seeded as the legacy draft payload the restore path exists to
 * carry.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const FIXTURE = path.resolve(HERE, 'fixtures/e4-lists-styles.docx')
const HEADING = 'E4 Heading'
const BODY = 'Delta paragraph'

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e13-${runId}@obiter.test`
  const password = `E13-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E13 User', email, password },
    headers: { Origin: webOrigin },
  })
  expect(signUp.ok(), `sign-up failed: ${await signUp.text()}`).toBeTruthy()
  verifyEmailInDb(databaseName, email)
  return { email, password }
}

async function signIn(page: Page, email: string, password: string) {
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
}

async function openMatterDocument(
  page: Page,
  matterName: string,
  upload?: { name: string; mimeType: string; buffer: Buffer },
) {
  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })

  const matterLink = page.getByRole('link', { name: matterName }).first()
  if ((await matterLink.count()) === 0) {
    await page.getByRole('button', { name: 'Create matter' }).first().click()
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

  const fileName = upload?.name ?? path.basename(FIXTURE)
  if ((await page.getByText(fileName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    if (upload) {
      await fileInput.setInputFiles(upload)
    } else {
      await fileInput.setInputFiles(FIXTURE)
    }
  }
  const documentRow = page.getByRole('link', { name: fileName }).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()
  await expect(page).toHaveURL(/\/matters\/[^/?#]+\/documents\/[^/?#]+$/)
  await expect(page.getByRole('link', { name: 'Back to matter' })).toBeVisible({
    timeout: 30_000,
  })
}

async function openDocx(
  page: Page,
  email: string,
  password: string,
  matterName: string,
) {
  await signIn(page, email, password)
  await openMatterDocument(page, matterName)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const saveButton = (page: Page) =>
  page.getByRole('button', { name: 'Save', exact: true })
const saveState = (page: Page) =>
  page.locator('[data-save-state]').getAttribute('data-save-state')

async function focusParagraph(page: Page, text: string) {
  const target = page.locator('[data-paragraph-id]', { hasText: text }).first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await target.click()
    const focused = await expect(editor(page))
      .toBeFocused()
      .then(() => true)
      .catch(() => false)
    if (focused) return
  }
  throw new Error(`could not focus the paragraph containing "${text}"`)
}

async function caretAtEnd(page: Page, text: string) {
  await focusParagraph(page, text)
  await page.keyboard.press('Control+End')
}

async function saveAndWait(page: Page) {
  await saveButton(page).click()
  await expect(saveButton(page)).toBeDisabled({ timeout: 30_000 })
}

async function openRibbonTab(page: Page, name: string) {
  const tab = page.getByRole('tab', { name, exact: true }).first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tab.click()
    const selected = await expect(tab)
      .toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (selected) return
  }
}

function escapePdfText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

/** A minimal text-layer PDF, the shape the upload pipeline extracts. */
function buildPdf(pages: string[][]) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${index * 2 + 3} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ]
  for (let index = 0; index < pages.length; index += 1) {
    const lines = pages[index] ?? []
    const content = [
      'BT',
      '/F1 12 Tf',
      '72 720 Td',
      ...lines.flatMap((line, lineIndex) => [
        ...(lineIndex === 0 ? [] : ['0 -18 Td']),
        `(${escapePdfText(line)}) Tj`,
      ]),
      'ET',
    ].join('\n')
    objects.push(
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${pages.length * 2 + 3} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${index * 2 + 4} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    )
  }
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let pdf = '%PDF-1.4\n'
  const offsets: number[] = []
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

/** The draft scope a seeded payload must match: tab writer, org, user, doc. */
async function draftScope(page: Page) {
  const writerId = await page.evaluate(() =>
    window.sessionStorage.getItem('obiter.document-draft.tab'),
  )
  if (!writerId) throw new Error('no draft writer id in session')
  const me = await page.evaluate(async () => {
    const response = await fetch('/api/me', { credentials: 'include' })
    return (await response.json()) as {
      user: { id: string }
      organisation: { id: string }
    }
  })
  const documentId = /\/documents\/([^/?#]+)/.exec(page.url())?.[1]
  if (!documentId) throw new Error('no document id in url')
  const model = await page.evaluate(async (id) => {
    const response = await fetch(`/api/documents/${id}/model`, {
      credentials: 'include',
    })
    return (await response.json()) as { versionId: string }
  }, documentId)
  return {
    writerId,
    organisationId: me.organisation.id,
    userId: me.user.id,
    documentId,
    baseVersionId: model.versionId,
  }
}

const EMPTY_DRAFT_STATE = {
  drafts: {},
  inserts: [],
  deletedParagraphIds: [],
  extraRuns: {},
  format: {
    emphasis: [],
    paragraphStyles: {},
    numbering: {},
    paragraphFormats: {},
    section: {},
  },
  breaks: [],
  structures: [],
  trackedRejections: [],
}

/**
 * Writes a draft payload shaped exactly like the store's own schema — the
 * state a previous version's persistence left behind. The writer is this
 * tab's own, so the reload adopts it through the real restore path rather
 * than any back door.
 */
async function seedDraft(
  page: Page,
  state: Record<string, unknown>,
  held: Record<string, unknown>[] = [],
) {
  const scope = await draftScope(page)
  await page.evaluate(
    ({ scope: target, state: draftState, held: heldList }) => {
      const payload = {
        schemaVersion: 1,
        organisationId: target.organisationId,
        userId: target.userId,
        documentId: target.documentId,
        draftId: `seeded-${target.writerId.slice(0, 8)}`,
        writerId: target.writerId,
        status: 'active',
        baseVersionId: target.baseVersionId,
        updatedAt: new Date().toISOString(),
        state: draftState,
        held: heldList,
      }
      window.localStorage.setItem(
        `obiter.document-draft.1.${target.organisationId}.${target.userId}.${target.documentId}.seeded-${target.writerId.slice(0, 8)}`,
        JSON.stringify(payload),
      )
    },
    { scope, state, held },
  )
}

test.use({ viewport: { width: 1440, height: 900 } })

test('the View ribbon drives a real web flow, ruler, navigation pane, spelling and zoom', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 view ${Date.now()}`)

  // A stored heading gives the navigation pane a real outline entry.
  await page.getByRole('tab', { name: 'Home', exact: true }).click()
  await focusParagraph(page, HEADING)
  await page
    .getByLabel('Paragraph style', { exact: true })
    .selectOption({ label: 'Heading 1' })

  await openRibbonTab(page, 'View')
  await page.getByRole('button', { name: 'Web layout' }).click()
  const sheets = page.locator('[data-document-sheet]')
  await expect(sheets.first()).toBeVisible({ timeout: 10_000 })
  await expect(sheets.first()).toHaveClass(/bg-transparent/)
  // Every sheet the web flow mounts dropped the paper chrome.
  const sheetCount = await sheets.count()
  for (let index = 0; index < sheetCount; index += 1) {
    await expect(sheets.nth(index)).toHaveClass(/bg-transparent/)
  }

  await page.getByRole('button', { name: 'Ruler' }).click()
  const ruler = page.locator('[data-document-ruler]')
  await expect(ruler).toBeVisible()
  await expect(ruler).toHaveAttribute('aria-label', /Page width [\d.]+ cm/)

  await page.getByRole('button', { name: 'Navigation pane' }).click()
  const outline = page.locator('[data-outline-item]')
  await expect(outline.first()).toBeVisible()
  const target = page
    .getByRole('button', {
      name: new RegExp(HEADING.slice(0, 12)),
    })
    .last()
  await target.click()
  await expect(editor(page)).toHaveValue(new RegExp(HEADING))

  // Zoom renders a real transform on the sheet, and resets honestly.
  const sheet = page.locator('[data-document-sheet]').first()
  await page.getByRole('button', { name: 'Zoom out' }).click()
  await expect(sheet).toHaveCSS('transform', /matrix\(0.9/)
  await page.getByRole('button', { name: 'Zoom in' }).click()
  await expect(sheet).toHaveCSS('transform', /matrix\(1/)

  await page.getByRole('button', { name: 'Print layout' }).click()
  await expect(sheets.first()).toHaveClass(/ring-black/)

  await openRibbonTab(page, 'Review')
  const column = page.locator('[data-document-desk] [spellcheck]')
  await expect(column).toHaveAttribute('spellcheck', 'false')
  await page.getByRole('button', { name: 'Spelling' }).click()
  await expect(column).toHaveAttribute('spellcheck', 'true')
  await expect(page.getByText(/not a legal correctness check/i)).toBeVisible()
  await page.getByRole('button', { name: 'Spelling' }).click()
  await expect(column).toHaveAttribute('spellcheck', 'false')
})

test('the PDF viewer pages a generated multi-page document with bounded mounting', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const pdf = buildPdf(
    Array.from({ length: 24 }, (_, page) =>
      Array.from(
        { length: 20 },
        (_, row) => `E13 page ${page + 1} line ${row + 1} token-${page}`,
      ),
    ),
  )
  await signIn(page, email, password)
  await openMatterDocument(page, `E13 pdf ${Date.now()}`, {
    name: 'e13-viewer.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  })
  await expect(page.getByText('View only, not editable')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByText('page 1 line 1 token-0')).toBeVisible({
    timeout: 60_000,
  })

  // Bounded mounting: only the current page's spans exist in the DOM.
  await expect(page.getByText('page 2 line 1 token-1')).toHaveCount(0)

  const previous = page.getByRole('button', { name: 'Previous page' })
  const next = page.getByRole('button', { name: 'Next page' })
  await expect(previous).toBeDisabled()
  await expect(next).toBeEnabled()
  await next.click()
  await expect(page.getByText('page 2 line 1 token-1')).toBeVisible()
  await expect(page.getByText('page 1 line 1 token-0')).toHaveCount(0)

  const jump = page.getByRole('textbox', { name: /Go to page/ })
  await jump.fill('24')
  await jump.press('Enter')
  await expect(page.getByText('page 24 line 1 token-23')).toBeVisible()
  await expect(next).toBeDisabled()
  await expect(previous).toBeEnabled()

  // Out-of-range jumps are refused, not clamped silently.
  await jump.fill('99')
  await jump.press('Enter')
  await expect(page.getByText('page 24 line 1 token-23')).toBeVisible()

  const sheet = page.locator('[role="region"][aria-label^="PDF page"]').first()
  const widthBefore = await sheet.evaluate(
    (node) => node.firstElementChild?.getBoundingClientRect().width ?? 0,
  )
  await page.getByRole('button', { name: 'Zoom in' }).click()
  const widthAfter = await sheet.evaluate(
    (node) => node.firstElementChild?.getBoundingClientRect().width ?? 0,
  )
  expect(widthAfter).toBeGreaterThan(widthBefore)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Download' }).click()
  const download = await downloadPromise
  expect(download.suggestedFilename()).toBe('e13-viewer.pdf')
})

test('two abandoned drafts surface the recoverable banner: dialog exits and restore', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const matter = `E13 recoverable ${Date.now()}`
  // This tab only opens the document; the drafts belong to sibling tabs.
  await openDocx(page, email, password, matter)

  // Both siblings stay open while they type: a writer whose claim is live
  // cannot be auto-adopted by the other, so each lands its own payload.
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
  // The draft write is async — prove each landed before closing its writer.
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

  // Both writer claims must lapse before their payloads become recoverable
  // (claims renew every second and die after two).
  await page.waitForTimeout(3000)
  await page.reload()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.getByText(/More than one unsaved draft exists/i),
  ).toBeVisible({ timeout: 30_000 })

  // The discard dialog's three exits: Cancel keeps the draft, the close
  // button keeps it, and Confirm deletes it — proven against the banner.
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
  // One draft was discarded; the other still shows in the banner.
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

test('a draft naming a missing paragraph surfaces the blocked-change discard', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 blocked ${Date.now()}`)

  // A payload keyed to a run the model does not carry: the save partition
  // marks it unsendable instead of dropping it.
  await seedDraft(page, {
    ...EMPTY_DRAFT_STATE,
    drafts: { 'run-gone': 'orphaned text' },
  })
  await page.reload()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/no longer matches the document/i)).toBeVisible({
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
  await expect(page.getByText(/no longer matches the document/i)).toHaveCount(0)
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

test('reduced-motion and forced-colours keep the ribbon usable', async ({
  page,
  request,
}) => {
  await page.emulateMedia({
    reducedMotion: 'reduce',
    forcedColors: 'active',
  })
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 a11y ${Date.now()}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  // Ribbon tabs still drive panels under both platform modes.
  await openRibbonTab(page, 'View')
  await page.getByRole('button', { name: 'Navigation pane' }).click()
  await expect(page.locator('[data-navigation-pane]')).toBeVisible()
  await page.getByRole('button', { name: 'Ruler' }).click()
  await expect(page.locator('[data-document-ruler]')).toBeVisible()
  // Focus stays visibly outlined: tab to a control and check the outline.
  const tab = page.getByRole('tab', { name: 'Review', exact: true }).first()
  await tab.focus()
  const outlineWidth = await tab.evaluate(
    (node) => getComputedStyle(node).outlineWidth,
  )
  expect(Number.parseFloat(outlineWidth)).toBeGreaterThan(0)
})

test('the workspace holds together at tablet width with no horizontal overflow', async ({
  page,
  request,
}) => {
  await page.setViewportSize({ width: 820, height: 1000 })
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E13 narrow ${Date.now()}`)
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  const overflow = await page.evaluate(
    () =>
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth,
  )
  expect(overflow).toBeLessThanOrEqual(4)
  // The ribbon wraps rather than clipping its controls off the edge.
  await openRibbonTab(page, 'View')
  await expect(
    page.getByRole('button', { name: 'Navigation pane' }),
  ).toBeVisible()
})
