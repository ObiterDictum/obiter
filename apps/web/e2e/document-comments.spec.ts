import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { verifyEmailInDb } from './support'

/*
 * E8 browser journey: comments must survive the whole product path. A real
 * browser decides the native selection the caret mirror reports, the panel's
 * rendered state, and the download the export endpoint produces; the mounted
 * suites cover the anchor math and the wire shapes.
 *
 * The fixture is generated at runtime into /tmp from the OOXML builder so the
 * imported Word comment is a real comments.xml part, not a committed file. The
 * account is synthetic, created through the product's own sign-up endpoint, and
 * email verification is marked in the task-owned test database.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const REPO_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../..',
)
const FIXTURE_PATH = '/tmp/e8-comments-fixture.docx'
const FIXTURE_NAME = path.basename(FIXTURE_PATH)
/** The fixture paragraph carrying the imported Word comment's range markers. */
const COMMENTED = 'Commented text'
/** Nine code units, so the selection never cuts a surrogate pair. */
const SELECTED = 'Commented'
const IMPORTED_BODY = 'Fictional review comment'
const IMPORTED_AUTHOR = 'Alice Example'

function buildFixture() {
  if (existsSync(FIXTURE_PATH)) return
  execFileSync(
    'bun',
    [
      '-e',
      `const { buildOoxmlFixture } = await import('${REPO_ROOT}/packages/ooxml/fixtures/builder.ts'); const bytes = await buildOoxmlFixture('full-fidelity-with-w14-ids'); await Bun.write('${FIXTURE_PATH}', bytes)`,
    ],
    { cwd: REPO_ROOT, stdio: 'pipe' },
  )
}

async function createAccount(request: APIRequestContext) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `e8-${runId}@obiter.test`
  const password = `E8-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E8 User', email, password },
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

/** Opens the generated comment fixture through the product's own navigation. */
async function openFixtureDocument(
  page: Page,
  email: string,
  password: string,
  matterName: string,
) {
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

  if ((await page.getByText(FIXTURE_NAME).count()) === 0) {
    const fileInput = page.locator('input[aria-label="Upload document"]')
    await expect(fileInput).toBeAttached({ timeout: 20_000 })
    await fileInput.setInputFiles(FIXTURE_PATH)
  }
  const documentRow = page.getByText(FIXTURE_NAME).first()
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

async function openCommentsPanel(page: Page) {
  // The ribbon mounts its tabs once the document model arrives, so a click
  // that lands during that transition can revert to Home. Retry the whole
  // selection instead of assuming the first click stuck.
  const panel = page.getByRole('complementary', { name: 'Comments' })
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.getByRole('tab', { name: 'Review' }).click()
    const button = page.getByRole('button', { name: /^Comments/u }).last()
    const clicked = await button
      .click({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (!clicked) continue
    const shown = await expect(panel)
      .toBeVisible({ timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (shown) return
  }
  throw new Error('could not open the Comments panel')
}

type CommentBody = {
  anchor?: {
    paragraphId?: string
    endParagraphId?: string
    startOffset?: number
    endOffset?: number
  }
}

function isCommentBody(value: unknown): value is CommentBody {
  return typeof value === 'object' && value !== null && 'anchor' in value
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

test('comments anchor, navigate, reply, resolve and export', async ({
  page,
  browser,
  request,
}) => {
  buildFixture()
  const { email, password } = await createAccount(request)
  const matter = `E8 comments ${String(Date.now())}`
  await openFixtureDocument(page, email, password, matter)

  const createBodies: CommentBody[] = []
  page.on('request', (outgoing) => {
    if (
      /\/api\/documents\/[^/]+\/comments$/u.test(outgoing.url()) &&
      outgoing.method() === 'POST'
    ) {
      const body = outgoing.postDataJSON()
      if (isCommentBody(body)) createBodies.push(body)
    }
  })

  await openCommentsPanel(page)

  // The imported Word comment renders with its own author and body, not the
  // uploader's identity.
  const importedCard = page.locator('li', { hasText: IMPORTED_BODY }).first()
  await expect(importedCard).toBeVisible({ timeout: 15_000 })
  await expect(importedCard).toContainText(IMPORTED_AUTHOR)
  await expect(
    page.getByRole('heading', { name: 'From the Word file' }),
  ).toBeVisible()

  // A real selected range anchors the product comment — not the paragraph.
  await selectFirst(page, COMMENTED, SELECTED.length)
  await page.getByLabel('New comment').fill('Tighten this clause')
  const createResponse = page.waitForResponse(
    (incoming) =>
      /\/api\/documents\/[^/]+\/comments$/u.test(incoming.url()) &&
      incoming.request().method() === 'POST',
  )
  await page.getByRole('button', { name: 'Add comment' }).click()
  const created = await createResponse
  expect(created.status(), await created.text()).toBe(201)
  const card = page.locator('li', { hasText: 'Tighten this clause' }).first()
  await expect(card).toBeVisible({ timeout: 15_000 })
  await expect(card).toContainText('Open')

  expect(createBodies.length).toBe(1)
  expect(createBodies[0]?.anchor).toMatchObject({
    startOffset: 0,
    endOffset: SELECTED.length,
  })
  expect(createBodies[0]?.anchor?.paragraphId).toBeTruthy()
  expect(createBodies[0]?.anchor).not.toHaveProperty('endParagraphId')

  // Clicking away clears the selection; the card restores it on navigation.
  await page.keyboard.press('Escape')
  await card.getByRole('button', { name: 'Show in document' }).click()
  await expect(page.locator('[data-selected-text="true"]').first()).toHaveText(
    SELECTED,
  )

  // Replies and resolve/reopen are author-owned controls on the same thread.
  await card.getByLabel('Reply').fill('Second voice on the clause')
  const replyResponse = page.waitForResponse(
    (incoming) =>
      /\/comments\/[^/]+\/replies$/u.test(incoming.url()) &&
      incoming.request().method() === 'POST',
  )
  await card.getByRole('button', { name: 'Reply' }).click()
  const replied = await replyResponse
  expect(replied.status(), await replied.text()).toBe(201)
  await expect(card).toContainText('Second voice on the clause', {
    timeout: 15_000,
  })

  await card.getByRole('button', { name: 'Resolve' }).click()
  await expect(card).toContainText('Resolved', { timeout: 15_000 })
  await card.getByRole('button', { name: 'Reopen' }).click()
  await expect(card).toContainText('Open', { timeout: 15_000 })

  // An insertion-point comment anchors at the caret with equal offsets.
  await focusParagraph(page, COMMENTED)
  await page.keyboard.press('End')
  await page.getByLabel('New comment').fill('Caret note')
  await page.getByRole('button', { name: 'Add comment' }).click()
  await expect(
    page.locator('li', { hasText: 'Caret note' }).first(),
  ).toBeVisible({ timeout: 15_000 })
  expect(createBodies.length).toBe(2)
  const caretAnchor = createBodies[1]?.anchor
  expect(caretAnchor?.startOffset).toBe(caretAnchor?.endOffset)

  // Export produces a DOCX whose comments part carries the foreign comment,
  // the product comments, and the product reply.
  const downloadPromise = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Export', exact: true }).click()
  const download = await downloadPromise
  const exportPath = await download.path()
  const commentsXml = zipPart(exportPath, 'word/comments.xml')
  expect(commentsXml).toContain('Fictional review comment')
  expect(commentsXml).toContain('Tighten this clause')
  expect(commentsXml).toContain('Caret note')
  expect(commentsXml).toContain('Second voice on the clause')
  expect(commentsXml).toContain('Alice Example')

  // A fresh context reads the stored state back: the product comments and the
  // imported thread render without the first session.
  const fresh = await browser.newContext()
  const reloaded = await fresh.newPage()
  try {
    await openFixtureDocument(reloaded, email, password, matter)
    await openCommentsPanel(reloaded)
    await expect(
      reloaded.locator('li', { hasText: 'Tighten this clause' }).first(),
    ).toBeVisible({ timeout: 15_000 })
    await expect(
      reloaded.locator('li', { hasText: IMPORTED_BODY }).first(),
    ).toBeVisible()
    await expect(
      reloaded.locator('li', { hasText: 'Caret note' }).first(),
    ).toBeVisible()
  } finally {
    await fresh.close()
  }
})
