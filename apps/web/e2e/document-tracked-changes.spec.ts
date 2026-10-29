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
import {
  closeMenu,
  menuItem,
  openMenu,
  runMenuCommand,
  setTrackChanges,
  trackChangesSwitch,
} from './editor-chrome'
import { verifyEmailInDb } from './support'

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const FIXTURE_PATH = '/tmp/e9-tracked-changes-fixture.docx'
const MIXED_PATH = '/tmp/e9-tracked-changes-mixed-fixture.docx'
const INLINE_PATH = '/tmp/e9-inline-tracked-changes-fixture.docx'
const MIXED_MARKUP =
  '<w:p><w:moveFromRangeStart w:id="40" w:name="orphanMove" w:author="Jane Example" w:date="2026-08-10T10:06:00Z"/><w:moveFrom w:id="30" w:author="Jane Example" w:date="2026-08-10T10:06:00Z"><w:r><w:delText>Stranded move</w:delText></w:r></w:moveFrom><w:moveFromRangeEnd w:id="40"/></w:p>'
const MIXED_ANCHOR =
  '<w:sectPr><w:headerReference w:type="default" r:id="rId5"/>'
const PLAIN = 'Alice Example overview'
const SELECTED = 'Alice'
const USER_NAME = 'E9 User'

function buildFixture() {
  for (const fixturePath of [FIXTURE_PATH, MIXED_PATH]) {
    if (existsSync(fixturePath)) rmSync(fixturePath)
  }
  execFileSync(
    'bun',
    [
      '-e',
      `const { buildOoxmlFixture } = await import('${REPO_ROOT}/packages/ooxml/fixtures/builder.ts'); const { default: JSZip } = await import('jszip'); const bytes = await buildOoxmlFixture('full-fidelity-with-w14-ids'); await Bun.write('${FIXTURE_PATH}', bytes); const zip = await JSZip.loadAsync(bytes); const xml = await zip.file('word/document.xml').async('string'); zip.file('word/document.xml', xml.replace('${MIXED_ANCHOR}', '${MIXED_MARKUP}' + '${MIXED_ANCHOR}')); await Bun.write('${MIXED_PATH}', await zip.generateAsync({ type: 'uint8array' }))`,
    ],
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
  await page.getByRole('button', { name: 'Sign in', exact: true }).click()
  await page.waitForURL((url) => !url.pathname.startsWith('/sign-in'), {
    timeout: 15_000,
  })
  await page.waitForLoadState('networkidle')
}

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
  page.getByRole('complementary', { name: 'Changes and comments' })

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

async function selectFirst(page: Page, text: string, units: number) {
  await focusParagraph(page, text)
  await page.keyboard.press('Home')
  for (let step = 0; step < units; step += 1) {
    await page.keyboard.press('Shift+ArrowRight')
  }
}

async function decideSelection(page: Page, action: 'Accept' | 'Reject') {
  const boxes = panel(page).getByRole('checkbox')
  await expect(boxes.first()).toBeVisible({ timeout: 15_000 })
  const count = await boxes.count()
  const label = `${String(count)} ${count === 1 ? 'change' : 'changes'}`
  for (let index = 0; index < count; index += 1) await boxes.nth(index).check()
  await panel(page)
    .getByRole('button', { name: `${action} ${label}`, exact: true })
    .click()
  if (action === 'Reject') {
    await panel(page)
      .getByRole('button', { name: `Reject ${label}`, exact: true })
      .click()
  }
}

async function openChangesPanel(page: Page) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await openMenu(page, 'Review')
      .then(() => true)
      .catch(() => false)
    if (!opened) continue
    const row = page.getByRole('menuitemcheckbox', { name: /^Changes/u })
    const clicked = await row
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (!clicked) continue
    await closeMenu(page).catch(() => undefined)
    const shown = await expect(panel(page))
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (shown) return
  }
  throw new Error('could not open the Changes panel')
}

async function reviewToggle(page: Page, on: boolean) {
  const toggle = trackChangesSwitch(page)
  await expect(toggle).toBeVisible({ timeout: 15_000 })
  await setTrackChanges(page, on)
  return toggle
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

  const list = panel(page).getByRole('list')
  await expect(list.getByRole('listitem')).toHaveCount(6, { timeout: 15_000 })
  await expect(list).toContainText('Alice Example')
  await expect(list).toContainText('Jane Example')
  await expect(list).toContainText('Insertion')
  await expect(list).toContainText('Deletion')
  await expect(list).toContainText('Move')
  await expect(list).toContainText('Formatting')
  await expect(panel(page)).toContainText('4 changes · 1 move · 1 comment')

  await openMenu(page, 'Review')
  const acceptChange = menuItem(page, 'Accept change')
  await expect(acceptChange).toBeDisabled()
  await expect(acceptChange).toHaveAttribute('aria-describedby', /.+/)
  await expect(
    page
      .getByText(
        'Go to a change first — use Previous, Next or the Changes list.',
      )
      .first(),
  ).toBeVisible()
  await closeMenu(page)

  await list.getByRole('button', { name: 'Show this change' }).first().click()
  await expect(panel(page)).toContainText('2 of 6')
  await panel(page).getByRole('button', { name: 'Next' }).click()
  await expect(panel(page)).toContainText('3 of 6')
  await expect(list.locator('li[aria-current="true"]')).toHaveCount(1)

  const rejectResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await runMenuCommand(page, 'Review', 'Reject change')
  const rejected = await rejectResponse
  expect(rejected.status(), await rejected.text()).toBe(201)
  await expect(list.getByRole('listitem')).toHaveCount(5, { timeout: 15_000 })
  await expect(panel(page)).toContainText('3 of 5')

  const acceptAllResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await decideSelection(page, 'Accept')
  const accepted = await acceptAllResponse
  expect(accepted.status(), await accepted.text()).toBe(201)
  await expect(panel(page)).toContainText('0 changes', { timeout: 15_000 })

  const downloadPromise = page.waitForEvent('download')
  await runMenuCommand(page, 'File', 'Export')
  const download = await downloadPromise
  const documentXml = zipPart(await download.path(), 'word/document.xml')
  expect(documentXml).not.toContain('<w:ins')
  expect(documentXml).not.toContain('<w:del ')
  expect(documentXml).not.toContain('<w:moveFrom')
  expect(documentXml).not.toContain('<w:moveTo')
  expect(documentXml).not.toContain('PrChange')
  expect(documentXml).toContain('Inserted')
  expect(documentXml).toContain('Deleted')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await openChangesPanel(reloaded)
    await expect(panel(reloaded)).toContainText('0 changes', {
      timeout: 15_000,
    })
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

  const list = panel(page).getByRole('list')
  await expect(list.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 })
  const undecidableRow = list.locator('li', { hasText: 'Stranded move' })
  await expect(undecidableRow).toContainText('This move cannot be decided here')
  await expect(undecidableRow.getByRole('button')).toHaveCount(1)
  await expect(
    undecidableRow.getByRole('button', { name: 'Show this change' }),
  ).toBeVisible()
  await expect(undecidableRow.getByText("Move · can't be paired")).toBeVisible()
  await undecidableRow.getByRole('button', { name: 'Show this change' }).click()
  await expect(panel(page)).toContainText('7 of 7')
  await openMenu(page, 'Review')
  const acceptChange = menuItem(page, 'Accept change')
  await expect(acceptChange).toBeDisabled()
  await expect(
    page
      .getByText(
        'This move cannot be decided here; it stays listed and unchanged in the document.',
      )
      .first(),
  ).toBeVisible()
  await closeMenu(page)

  await expect(undecidableRow.getByRole('checkbox')).toHaveCount(0)
  const bulkResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await decideSelection(page, 'Accept')
  const accepted = await bulkResponse
  expect(accepted.status(), await accepted.text()).toBe(201)
  const payload = accepted.request().postDataJSON() as {
    changeIds: string[]
  }
  expect(payload.changeIds).toHaveLength(6)
  expect(payload.changeIds).not.toContain(undecidableId)

  await expect(list.getByRole('listitem')).toHaveCount(2, { timeout: 15_000 })
  await expect(list.locator('li', { hasText: 'Stranded move' })).toContainText(
    'This move cannot be decided here',
  )

  const downloadPromise = page.waitForEvent('download')
  await runMenuCommand(page, 'File', 'Export')
  const xml = zipPart(await (await downloadPromise).path(), 'word/document.xml')
  expect(xml).toContain('w:name="orphanMove"')
  expect(xml).toContain('<w:moveFrom ')
  expect(xml).toContain('Stranded move')
  expect(xml).not.toContain('<w:ins')
  expect(xml).not.toContain('<w:del ')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter, MIXED_PATH)
    await openChangesPanel(reloaded)
    const reloadedList = panel(reloaded).getByRole('list')
    await expect(reloadedList.getByRole('listitem')).toHaveCount(2, {
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

  await openChangesPanel(page)
  await setTrackChanges(page, true)

  await selectFirst(page, PLAIN, SELECTED.length)
  await page.getByRole('button', { name: 'Bold', exact: true }).click()

  const saveResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/edit$/u.test(incoming.url()) &&
      incoming.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Save' }).first().click()
  const saved = await saveResponse
  expect(saved.status(), await saved.text()).toBe(201)

  await openChangesPanel(page)
  const list = panel(page).getByRole('list')
  await expect(list.getByRole('listitem')).toHaveCount(7, { timeout: 15_000 })
  const recorded = list.locator('li', { hasText: USER_NAME }).first()
  await expect(recorded).toBeVisible()
  await expect(recorded).toContainText('Formatting')

  const pendingDownload = page.waitForEvent('download')
  await runMenuCommand(page, 'File', 'Export')
  const pendingXml = zipPart(
    await (await pendingDownload).path(),
    'word/document.xml',
  )
  expect(pendingXml).toContain('<w:rPrChange')
  expect(pendingXml).toContain(`>${SELECTED}</w:t>`)
  expect(pendingXml).toContain(' Example overview')

  const decisionResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/tracked-changes\/decision$/u.test(
        incoming.url(),
      ) && incoming.request().method() === 'POST',
  )
  await decideSelection(page, 'Reject')
  const decided = await decisionResponse
  expect(decided.status(), await decided.text()).toBe(201)
  await expect(panel(page)).toContainText('0 changes', { timeout: 15_000 })

  const decidedDownload = page.waitForEvent('download')
  await runMenuCommand(page, 'File', 'Export')
  const decidedXml = zipPart(
    await (await decidedDownload).path(),
    'word/document.xml',
  )
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

  await reviewToggle(page, true)

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
  await runMenuCommand(page, 'File', 'Export')
  const docxPath = await (await downloadPromise).path()
  const documentXml = zipPart(docxPath, 'word/document.xml')
  const settingsXml = zipPart(docxPath, 'word/settings.xml')
  expect(documentXml).toContain('<w:delText>Alice</w:delText>')
  expect(documentXml).toContain('>Alicia</w:t>')
  expect(documentXml).not.toContain(`<w:delText>${PLAIN}`)
  expect(settingsXml).toContain('trackRevisions')

  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    const tracking = await reviewToggle(reloaded, true)

    await tracking.click()
    await expect(trackChangesSwitch(reloaded)).not.toBeChecked()
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

  const reread = await browser.newContext()
  const rereadPage = await reread.newPage()
  try {
    await openFixtureDocument(rereadPage, email, password, matter)
    await reviewToggle(rereadPage, false)
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
  await setTrackChanges(page, true)
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
  await setTrackChanges(page, false)
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
  await openChangesPanel(page)
  await expect(trackChangesSwitch(page)).toBeChecked()
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
    const x = rect.left + 0.5
    const y = rect.top + rect.height / 2
    const caret = document.caretPositionFromPoint(x, y)
    return {
      x,
      y,
      hitInside: element.contains(caret?.offsetNode ?? null),
      offset: caret?.offset,
    }
  })
  expect(point.hitInside).toBe(true)
  expect(point.offset).toBe(2)
  await page.mouse.click(point.x, point.y)
  await page.keyboard.type('X')
  await expect(
    page.locator('[data-paragraph-id] [data-inline-editable="true"]'),
  ).toHaveText('45X,000')
  await page.screenshot({ path: '/tmp/obiter-r2-caret-after.png' })
})
