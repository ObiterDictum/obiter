import { documentEditRequestSchema } from '@obiter/contracts'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { verifyEmailInDb } from './support'

/*
 * E9 browser journey: tracked changes must survive the whole product path.
 * A real browser decides the native selection the caret mirror reports, the
 * panel's rendered active state, and the exported DOCX a reviewer reopens;
 * the mounted suites cover the wire shapes and the decision engine.
 *
 * The fixture is generated at runtime into /tmp from the OOXML builder so the
 * imported revisions are real w:ins/w:del/move parts, not a committed file.
 * The account is synthetic, created through the product's own sign-up
 * endpoint, and email verification is marked in the task-owned test database.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const FIXTURE_PATH = '/tmp/e9-tracked-changes-fixture.docx'
/** The same fixture plus a one-sided move container the engine cannot decide. */
const MIXED_PATH = '/tmp/e9-tracked-changes-mixed-fixture.docx'
const INLINE_PATH = '/tmp/e9-inline-tracked-changes-fixture.docx'
const MIXED_MARKUP =
  '<w:p><w:moveFromRangeStart w:id="40" w:name="orphanMove" w:author="Jane Example" w:date="2026-08-10T10:06:00Z"/><w:moveFrom w:id="30" w:author="Jane Example" w:date="2026-08-10T10:06:00Z"><w:r><w:delText>Stranded move</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="40"/></w:p>'
const MIXED_ANCHOR =
  '<w:sectPr><w:headerReference w:type="default" r:id="rId5"/>'
/** A plain untracked paragraph whose single run the mid-run format splits. */
const PLAIN = 'Alice Example overview'
/** Five code units, so the selection never cuts a surrogate pair. */
const SELECTED = 'Alice'
const USER_NAME = 'E9 User'

function buildFixture() {
  // Always rebuild: a cached fixture keeps the shape the builder emitted when
  // it was written, so an existsSync guard silently reruns stale markup.
  for (const fixturePath of [FIXTURE_PATH, MIXED_PATH]) {
    if (existsSync(fixturePath)) rmSync(fixturePath)
  }
  execFileSync(
    'bun',
    [
      '-e',
      `const { buildOoxmlFixture } = await import('${REPO_ROOT}/packages/ooxml/fixtures/builder.ts'); const { default: JSZip } = await import('jszip'); const bytes = await buildOoxmlFixture('full-fidelity-with-w14-ids'); await Bun.write('${FIXTURE_PATH}', bytes); const zip = await JSZip.loadAsync(bytes); const xml = await zip.file('word/document.xml').async('string'); zip.file('word/document.xml', xml.replace('${MIXED_ANCHOR}', '${MIXED_MARKUP}' + '${MIXED_ANCHOR}')); await Bun.write('${MIXED_PATH}', await zip.generateAsync({ type: 'uint8array' }))`,
    ],
    // jszip is an @obiter/ooxml dependency — the eval resolves it from that
    // package's directory, not from the repository root.
    { cwd: `${REPO_ROOT}/packages/ooxml`, stdio: 'pipe' },
  )
}

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e9-${runId}@obiter.test`
  const password = `E9-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: USER_NAME, email, password },
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

/** Opens the generated revision fixture through the product's own navigation. */
async function openFixtureDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
  fixturePath = FIXTURE_PATH,
) {
  const fixtureName = path.basename(fixturePath)
  await signIn(page, email, password)

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

  if ((await page.getByText(fixtureName).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(fixturePath)
  }
  const documentRow = page.getByText(fixtureName).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()

  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

const editor = (page: Page) =>
  page.getByLabel('Paragraph text', { exact: true })
const paragraph = (page: Page, text: string) =>
  page.locator('[data-paragraph-id]', { hasText: text }).first()
const panel = (page: Page) =>
  page.getByRole('complementary', { name: 'Tracked changes' })

async function focusParagraph(page: Page, text: string) {
  const target = paragraph(page, text)
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

/** A native within-paragraph selection the custom selection mirrors. */
async function selectFirst(page: Page, text: string, units: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Home')
  for (let step = 0; step < units; step += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
}

async function openChangesPanel(page: Page) {
  // The ribbon mounts its tabs once the document model arrives, so a click
  // that lands during that transition can revert to Home. Retry the whole
  // selection instead of assuming the first click stuck.
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('tab', { name: 'Review' }).click()
    const button = page.getByRole('button', { name: /^Changes/u }).last()
    const clicked = await button
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (!clicked) continue
    const shown = await expect(panel(page))
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (shown) return
  }
  throw new Error('could not open the Changes panel')
}

function zipPart(docxPath: string, partName: string) {
  return execFileSync(
    'python3',
    [
      '-c',
      'import zipfile, sys; sys.stdout.write(zipfile.ZipFile(sys.argv[1]).read(sys.argv[2]).decode())',
      docxPath,
      partName,
    ],
    { encoding: 'utf-8' },
  )
}

test.use({ viewport: { width: 1440, height: 900 } })

test('imported revisions navigate, decide singly and in bulk, and export', async ({
  page,
  browser,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  const matter = `E9 revisions ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  await openChangesPanel(page)

  // The imported revisions render with author, kind and covered text — six
  // changes: ins, del, the move pair and the two property markers.
  const list = panel(page).getByRole('list')
  await expect(list.getByRole('listitem')).toHaveCount(6, { timeout: 15_000 })
  await expect(list).toContainText('Alice Example')
  await expect(list).toContainText('Jane Example')
  await expect(list).toContainText('insert · ins')
  await expect(list).toContainText('delete · del')
  await expect(list).toContainText('move · moveFrom')
  await expect(list).toContainText('property · rPrChange')

  // No change is active yet; the ribbon's single Accept/Reject publish why.
  await expect(
    page.getByRole('button', {
      name: 'Accept change: Go to a change first — use Previous, Next or the Changes list.',
    }),
  ).toBeDisabled()

  // Panel navigation marks the active row and reveals it in the document.
  await list.getByRole('button', { name: 'Show this change' }).first().click()
  await expect(panel(page)).toContainText('1 of 6')
  await panel(page).getByRole('button', { name: 'Next' }).click()
  await expect(panel(page)).toContainText('2 of 6')
  await expect(list.locator('li[aria-current="true"]')).toHaveCount(1)

  // Rejecting the active change from the ribbon writes one immutable
  // version; the decided change leaves the list and its slot names the next.
  const rejectResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await page
    .getByRole('button', { name: 'Reject change', exact: true })
    .first()
    .click()
  const rejected = await rejectResponse
  expect(rejected.status(), await rejected.text()).toBe(201)
  await expect(list.getByRole('listitem')).toHaveCount(5, { timeout: 15_000 })
  await expect(panel(page)).toContainText('2 of 5')

  // Bulk accept lands the remaining five in one atomic version.
  const acceptAllResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await panel(page).getByRole('button', { name: 'Accept all' }).click()
  const accepted = await acceptAllResponse
  expect(accepted.status(), await accepted.text()).toBe(201)
  await expect(
    page.getByRole('heading', { name: 'No tracked changes' }),
  ).toBeVisible({ timeout: 15_000 })

  // The export resolves every marker: no tracked element survives, the
  // accepted insertion stayed, and the rejected deletion kept its text.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const documentXml = zipPart(await download.path(), 'word/document.xml')
  expect(documentXml).not.toContain('<w:ins')
  expect(documentXml).not.toContain('<w:del ')
  expect(documentXml).not.toContain('<w:moveFrom')
  expect(documentXml).not.toContain('<w:moveTo')
  expect(documentXml).not.toContain('PrChange')
  expect(documentXml).toContain('Inserted')
  expect(documentXml).toContain('Deleted')

  // A fresh context reads the decided state back: the panel stays empty.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await openChangesPanel(reloaded)
    await expect(
      reloaded.getByRole('heading', { name: 'No tracked changes' }),
    ).toBeVisible({ timeout: 15_000 })
  } finally {
    await fresh.close()
  }
})

test('lists an undecidable move honestly and bulk-decides only supported changes', async ({
  page,
  browser,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  const matter = `E9 undecidable ${String(Date.now())}`
  // Capture the list response so the test knows the server's own verdict on
  // the undecidable change, not a client-side guess.
  const listResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes$/u.test(incoming.url()) &&
      incoming.request().method() === 'GET' &&
      incoming.status() === 200,
  )
  await openFixtureDocument(page, email, password, matter, MIXED_PATH)
  const listed = (await (await listResponse).json()) as {
    changes: { id: string; undecidable?: string }[]
  }
  const undecidable = listed.changes.filter(
    (change) => change.undecidable !== undefined,
  )
  const undecidableChange = undecidable[0]
  if (undecidable.length !== 1 || !undecidableChange) {
    throw new Error('Expected exactly one undecidable change in the list.')
  }
  expect(undecidableChange.undecidable).toBe('unsupported-move')
  const undecidableId = undecidableChange.id

  await openChangesPanel(page)

  // Seven changes: the six supported revisions plus the stranded move, which
  // renders marked and disabled while the row still navigates to it.
  const list = panel(page).getByRole('list')
  await expect(list.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 })
  const undecidableRow = list.locator('li', { hasText: 'Stranded move' })
  await expect(undecidableRow).toContainText('This move cannot be decided here')
  await expect(
    undecidableRow.getByRole('button', { name: 'Accept' }),
  ).toBeDisabled()
  await expect(
    undecidableRow.getByRole('button', { name: 'Reject' }),
  ).toBeDisabled()
  await undecidableRow.getByRole('button', { name: 'Show this change' }).click()
  await expect(panel(page)).toContainText('7 of 7')
  await expect(
    page.getByRole('button', {
      name: 'Accept change: This move cannot be decided here; it stays listed and unchanged in the document.',
    }),
  ).toBeDisabled()

  // Bulk names its real scope; the request carries the supported ids only,
  // so the undecidable change is never offered to the engine.
  await expect(
    page.getByRole('button', {
      name: 'Accept all supported changes',
      exact: true,
    }),
  ).toBeEnabled()
  const bulkResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await panel(page)
    .getByRole('button', { name: 'Accept all supported' })
    .click()
  const accepted = await bulkResponse
  expect(accepted.status(), await accepted.text()).toBe(201)
  const payload = accepted.request().postDataJSON() as {
    changeIds: string[]
  }
  expect(payload.changeIds).toHaveLength(6)
  expect(payload.changeIds).not.toContain(undecidableId)

  // The undecidable change is the only one left — still listed, still marked.
  await expect(list.getByRole('listitem')).toHaveCount(1, { timeout: 15_000 })
  await expect(list.locator('li', { hasText: 'Stranded move' })).toContainText(
    'This move cannot be decided here',
  )

  // The export keeps its markup untouched: nothing decided it silently, and
  // the supported changes resolved around it.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const xml = zipPart(await (await downloadPromise).path(), 'word/document.xml')
  expect(xml).toContain('w:name="orphanMove"')
  expect(xml).toContain('<w:moveFrom ')
  expect(xml).toContain('Stranded move')
  expect(xml).not.toContain('<w:ins')
  expect(xml).not.toContain('<w:del ')

  // A fresh context reads the same honest state back after the decision.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, MIXED_PATH)
    await openChangesPanel(reloaded)
    const reloadedList = panel(reloaded).getByRole('list')
    await expect(reloadedList.getByRole('listitem')).toHaveCount(1, {
      timeout: 15_000,
    })
    await expect(reloadedList).toContainText('Stranded move')
    await expect(reloadedList).toContainText('cannot be decided')
  } finally {
    await fresh.close()
  }
})

test('mid-run formatting tracks as a property change that rejects cleanly', async ({
  page,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  const matter = `E9 tracking ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // Wait for the model-backed ribbon before turning tracking on.
  await openChangesPanel(page)
  const tracking = page.getByRole('button', { name: /Track changes/u }).first()
  await expect(tracking).toBeVisible({ timeout: 15_000 })
  if ((await tracking.getAttribute('aria-pressed')) !== 'true') {
    await tracking.click()
  }
  await expect(
    page.getByRole('button', { name: 'Track changes on' }),
  ).toBeVisible()

  // Bold only the first five code units of an untouched single-run
  // paragraph; the run must split so the rest keeps its properties.
  await selectFirst(page, PLAIN, SELECTED.length)
  await page.getByRole('tab', { name: 'Home' }).click()
  await page.getByRole('button', { name: 'Bold' }).click()

  const saveResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/edit$/u.test(incoming.url()) &&
      incoming.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save' }).first().click()
  const saved = await saveResponse
  expect(saved.status(), await saved.text()).toBe(201)

  // The saved version lists the new property change under this session's
  // author alongside the six imported revisions.
  await openChangesPanel(page)
  const list = panel(page).getByRole('list')
  await expect(list.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 })
  const recorded = list.locator('li', { hasText: USER_NAME }).first()
  await expect(recorded).toBeVisible()
  await expect(recorded).toContainText('property · rPrChange')

  // The export carries a real w:rPrChange whose covered run is split off,
  // leaving the untouched tail intact in its own run.
  const pendingDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const pendingXml = zipPart(
    await (await pendingDownload).path(),
    'word/document.xml',
  )
  expect(pendingXml).toContain('<w:rPrChange')
  expect(pendingXml).toContain(`>${SELECTED}</w:t>`)
  expect(pendingXml).toContain(' Example overview')

  // Rejecting the recorded format restores the run's pre-change properties;
  // the text and its neighbours are untouched, and the export carries no
  // leftover marker or stray bold.
  const decisionResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await panel(page).getByRole('button', { name: 'Reject all' }).click()
  const decided = await decisionResponse
  expect(decided.status(), await decided.text()).toBe(201)
  await expect(
    page.getByRole('heading', { name: 'No tracked changes' }),
  ).toBeVisible({ timeout: 15_000 })

  const decidedDownload = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const decidedXml = zipPart(
    await (await decidedDownload).path(),
    'word/document.xml',
  )
  // The rejected format restores the run's pre-change properties: the pieces
  // stay split runs (decisions never merge runs), so the paragraph's text is
  // contiguous across `</w:t>` boundaries only — assert the pieces and the
  // absent marker rather than one literal text run.
  expect(decidedXml).not.toContain('PrChange')
  expect(decidedXml).toContain(`>${SELECTED}</w:t>`)
  expect(decidedXml).toContain(' Example overview')
})

test('a tracked mid-sentence edit records only the changed token and the toggle persists', async ({
  page,
  browser,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  const matter = `E9 granular ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  // The fixture's settings.xml carries w:trackRevisions, so the Review toggle
  // must open ON without a click — the persisted state, not a default.
  await page.getByRole('tab', { name: 'Review' }).click()
  const tracking = page
    .getByRole('button', { name: 'Track changes on' })
    .first()
  await expect(tracking).toBeVisible({ timeout: 15_000 })

  // Substitute the quantity inside the first paragraph's single run.
  await focusParagraph(page, PLAIN)
  await page.keyboard.press('Home')
  await page.keyboard.press('End')
  const original = await editor(page)
    .inputValue()
    .catch(() => '')
  expect(original).toContain(PLAIN)
  await page.keyboard.press('Home')
  for (let step = 0; step < PLAIN.length; step += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
  await page.keyboard.type('Alicia Example overview')

  const saveResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/edit$/u.test(incoming.url()) &&
      incoming.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  const saved = await saveResponse
  expect(saved.status(), await saved.text()).toBe(201)

  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const docxPath = await (await downloadPromise).path()
  const documentXml = zipPart(docxPath, 'word/document.xml')
  const settingsXml = zipPart(docxPath, 'word/settings.xml')
  // Only the changed token is wrapped; the sentence around it stays live runs.
  expect(documentXml).toContain('<w:delText>Alice</w:delText>')
  expect(documentXml).toContain('>Alicia</w:t>')
  expect(documentXml).not.toContain(`<w:delText>${PLAIN}`)
  expect(settingsXml).toContain('trackRevisions')

  // A fresh context reopens with tracking still on — the flag persisted.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await reloaded.getByRole('tab', { name: 'Review' }).click()
    await expect(
      reloaded.getByRole('button', { name: 'Track changes on' }).first(),
    ).toBeVisible({ timeout: 15_000 })

    // Flip the toggle off and save: a lone flip is a settings-only write —
    // the request carries an empty operation list and the pending value.
    await reloaded
      .getByRole('button', { name: 'Track changes on' })
      .first()
      .click()
    await expect(
      reloaded.getByRole('button', { name: 'Track changes off' }).first(),
    ).toBeVisible()
    const settingsSave = reloaded.waitForResponse(
      (incoming) =>
        /\/api\/documents\/[^/]+\/edit$/u.test(incoming.url()) &&
        incoming.request().method() === 'POST',
    )
    await reloaded
      .getByRole('button', { name: 'Save', exact: true })
      .first()
      .click()
    const flipped = await settingsSave
    expect(flipped.status(), await flipped.text()).toBe(201)
    expect(
      flipped.request().postDataJSON() as {
        operations: unknown[]
        trackChanges?: boolean
      },
    ).toEqual({
      baseVersionId: expect.any(String),
      operations: [],
      trackChanges: false,
    })
  } finally {
    await fresh.close()
  }

  // A third context reads the persisted off state back: the toggle must not
  // reopen on a default or on the stale value an earlier tab held.
  const reread = await browser.newContext()
  const rereadPage = await reread.newPage()
  try {
    await openFixtureDocument(rereadPage, email, password, matter)
    await rereadPage.getByRole('tab', { name: 'Review' }).click()
    await expect(
      rereadPage.getByRole('button', { name: 'Track changes off' }).first(),
    ).toBeVisible({ timeout: 15_000 })
  } finally {
    await reread.close()
  }
})

test('saved tracked text stays visible inline after reload and ordinary typing excludes it', async ({
  page,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  execFileSync(
    'bun',
    [
      '-e',
      `const { default: JSZip } = await import('jszip'); const zip = await JSZip.loadAsync(await Bun.file('${FIXTURE_PATH}').arrayBuffer()); const xml = await zip.file('word/document.xml').async('string'); zip.file('word/document.xml', xml.replace('<w:t>Alice Example overview</w:t></w:r>', '<w:t>Alice Example overview</w:t></w:r><w:r><w:t xml:space="preserve"> adjacent</w:t></w:r>')); await Bun.write('${INLINE_PATH}', await zip.generateAsync({ type: 'uint8array' }));`,
    ],
    { cwd: `${REPO_ROOT}/packages/ooxml`, stdio: 'pipe' },
  )
  await openFixtureDocument(
    page,
    email,
    password,
    `Inline markup ${String(Date.now())}`,
    INLINE_PATH,
  )
  await openChangesPanel(page)
  const tracking = page.getByRole('button', { name: /Track changes/u }).first()
  if ((await tracking.getAttribute('aria-pressed')) !== 'true')
    await tracking.click()
  await selectFirst(page, PLAIN, PLAIN.length)
  await page.keyboard.insertText('Alice Example revised summary')
  const saving = page.waitForResponse(
    (response) =>
      /\/api\/documents\/[^/]+\/edit$/u.test(response.url()) &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  expect((await saving).status()).toBe(201)
  await page.reload()
  const deletion = page
    .locator('[data-inline-change][data-change-kind="delete"]', {
      hasText: 'overview',
    })
    .first()
  const insertion = page
    .locator('[data-inline-change][data-change-kind="insert"]', {
      hasText: 'revised',
    })
    .first()
  await expect(deletion).toBeVisible()
  await expect(insertion).toBeVisible()
  await expect(deletion).toHaveCSS('text-decoration-line', 'line-through')
  await expect(insertion).toHaveCSS('text-decoration-line', 'underline')
  const target = insertion.locator('xpath=ancestor::*[@data-paragraph-id][1]')
  const id = await target.getAttribute('data-paragraph-id')
  await insertion.click()
  await expect(insertion).toHaveAttribute('aria-current', 'true')
  const selectedRow = panel(page).locator('li[aria-current="true"]')
  await expect(selectedRow).toContainText('revised')
  // Append at the unchanged editable paragraph end. Tracking is an independent
  // session toggle; explicitly switch it off for this ordinary follow-up edit.
  await page.getByRole('tab', { name: 'Review' }).click()
  const toggle = page.getByRole('button', { name: /Track changes/u }).first()
  if ((await toggle.getAttribute('aria-pressed')) === 'true')
    await toggle.click()
  await target.click()
  await editor(page).press('Control+End')
  await editor(page).pressSequentially(' tail')
  const savingTail = page.waitForResponse(
    (response) =>
      /\/api\/documents\/[^/]+\/edit$/u.test(response.url()) &&
      response.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save', exact: true }).first().click()
  const tail = await savingTail
  expect(tail.status(), await tail.text()).toBe(201)
  const payload = documentEditRequestSchema.parse(tail.request().postDataJSON())
  expect(payload.operations.length).toBeGreaterThan(0)
  expect(
    payload.operations
      .filter((op) => op.type === 'replace_run_text')
      .map((op) => op.text)
      .join(''),
  ).toContain('tail')
  expect(JSON.stringify(payload.operations)).not.toContain('revised')
  await page.reload()
  await expect(
    page.locator(`[data-paragraph-id="${id}"]`).first(),
  ).toContainText('tail')
  await expect(insertion).toBeVisible()
  await expect(deletion).toBeVisible()
})

test('native clicks place the caret inside an unsaved tracked insertion', async ({
  page,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  await openFixtureDocument(
    page,
    email,
    password,
    `E9 pending caret ${Date.now()}`,
  )
  await page.getByRole('tab', { name: 'Review' }).click()
  await expect(
    page.getByRole('button', { name: 'Track changes on' }),
  ).toBeVisible()
  await selectFirst(page, PLAIN, SELECTED.length)
  await page.keyboard.type('45,000')
  await page.keyboard.press('Escape')
  const insertion = page
    .locator('[data-paragraph-id] [data-inline-editable="true"]')
    .filter({ hasText: '45,000' })
  await expect(insertion).toHaveText('45,000')
  const point = await insertion.evaluate((element) => {
    const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT)
    const text = walker.nextNode()
    if (!text) throw new Error('Missing inserted text node')
    const range = document.createRange()
    range.setStart(text, 2)
    range.setEnd(text, 3)
    const rect = range.getBoundingClientRect()
    return { x: rect.left + 0.5, y: rect.top + rect.height / 2 }
  })
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type('X')
  await expect(
    page.locator('[data-paragraph-id] [data-inline-editable="true"]'),
  ).toHaveText('45X,000')
  await page.screenshot({ path: '/tmp/obiter-r2-caret-after.png' })
})
