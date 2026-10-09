import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  expect,
  test,
  type APIRequestContext,
  type Page,
} from '@playwright/test'
import { resolveJourneyTargets } from '../journey-target.mjs'
import { fixturePath, verifyEmailInDb } from './support'

/*
 * E12 browser journey: the Layout ribbon's classification controls must
 * commit immutable versions through the real API, the committed markings must
 * survive a reload and ride the DOCX export inside docProps/custom.xml, the
 * share-safe export must strip comments, signatures, identifying metadata and
 * foreign custom properties while keeping the product's own markings, and a
 * document-bound redaction run must return its finalized DOCX as a new linked
 * version. Filenames cross the wire non-ASCII so the RFC 5987 disposition and
 * the browser's download name are asserted, not assumed.
 *
 * The account is synthetic and created through the product's own sign-up
 * endpoint; verification is marked directly in the task-owned test database,
 * never the shared one. Fixtures are generated into /tmp, never committed.
 */

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const RICH_FIXTURE = path.join('/tmp', 'e12-rich.docx')

/**
 * A DOCX that exercises the share-safe removal half: comments, a signature,
 * identifying core properties and a foreign custom property, but no tracked
 * changes (which the policy must refuse, not silently accept or reject). The
 * tracked-change paragraphs are lifted straight out so the rest of the
 * fixture stays byte-identical to the ooxml suite's.
 */
const FIXTURE_SCRIPT = `
  const { buildOoxmlFixture } = await import('${REPO_ROOT}/packages/ooxml/fixtures/builder.ts')
  const { default: JSZip } = await import('jszip')
  const zip = await JSZip.loadAsync(await buildOoxmlFixture('full-fidelity-with-w14-ids'))
  const document = zip.file('word/document.xml')
  zip.file('word/document.xml', (await document.async('string'))
    .replace(/<w:p><w:ins[\\s\\S]*?<\\/w:p>/u, '')
    .replace(/<w:p><w:pPr><w:pPrChange[\\s\\S]*?<\\/w:p>/u, ''))
  const custom = await zip.file('docProps/custom.xml').async('string')
  zip.file('docProps/custom.xml', custom.replace('/>',
    '><property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="2" name="dms.matterRef"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">DMS-44</vt:lpwstr></property></Properties>'))
  await Bun.write('${RICH_FIXTURE}', await zip.generateAsync({ type: 'uint8array' }))
`

/** A non-ASCII upload name — the export dispositions must carry it exactly. */
const UNICODE_NAME = 'état des lieux — mémo.docx'
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function buildRichFixture() {
  rmSync(RICH_FIXTURE, { force: true })
  execFileSync('bun', ['-e', FIXTURE_SCRIPT], {
    // jszip is an @obiter/ooxml dependency — resolve it from there.
    cwd: `${REPO_ROOT}/packages/ooxml`,
    stdio: 'pipe',
  })
}

/** Unzip downloaded DOCX bytes to JSON of { part: xml } via the ooxml deps. */
function inspectDocx(filePath: string) {
  const stdout = execFileSync(
    'bun',
    [
      '-e',
      `const { default: JSZip } = await import('jszip')
       const zip = await JSZip.loadAsync(await Bun.file(process.env.DOCX_PATH).bytes())
       const parts = {}
       for (const [name, file] of Object.entries(zip.files)) {
         if (file.dir) continue
         parts[name] = name.endsWith('.xml') || name.endsWith('.rels')
           ? await file.async('string')
           : '<binary>'
       }
       process.stdout.write(JSON.stringify(parts))`,
    ],
    {
      cwd: `${REPO_ROOT}/packages/ooxml`,
      env: { ...process.env, DOCX_PATH: filePath },
      encoding: 'utf8',
    },
  )
  return JSON.parse(stdout) as Record<string, string>
}

async function createAccount(request: APIRequestContext, prefix: string) {
  const runId = crypto.randomUUID().replace(/-/g, '').slice(0, 10)
  const email = `${prefix}-${runId}@obiter.test`
  const password = `E12-${runId}-Aa1!`
  const signUp = await request.post(`${apiOrigin}/api/auth/sign-up/email`, {
    data: { name: 'E12 User', email, password },
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

/** Uploads the named DOCX into a fresh matter and opens it in the workspace. */
async function openUploadedDocument(
  page: Page,
  email: string,
  password: string,
  upload: { name: string; buffer: Buffer },
) {
  await signIn(page, email, password)
  const matterName = `E12 matter ${Date.now()}`
  await page.getByRole('link', { name: 'Matters' }).first().click()
  await expect(
    page.getByRole('heading', { name: 'Matters', exact: true }),
  ).toBeVisible({ timeout: 20_000 })
  await page.getByRole('button', { name: 'Create matter' }).first().click()
  await page.getByLabel('Matter name').fill(matterName)
  await page.getByLabel('Primary jurisdiction').fill('England & Wales')
  await page
    .getByRole('button', { name: 'Create matter', exact: true })
    .last()
    .click()
  // The dialog stays open after a successful create; dismiss it so the new
  // matter's link is clickable.
  await page
    .getByRole('button', { name: 'Cancel' })
    .click({ timeout: 5_000 })
    .catch(() => undefined)
  await page.getByRole('link', { name: matterName }).first().click()
  await expect(page).toHaveURL(/\/matters\//, { timeout: 20_000 })

  const fileInput = page.locator('input[aria-label="Upload document"]')
  await expect(fileInput).toBeAttached({ timeout: 20_000 })
  await fileInput.setInputFiles({
    name: upload.name,
    mimeType: DOCX_MIME,
    buffer: upload.buffer,
  })
  const documentRow = page.getByText(upload.name).first()
  await expect(documentRow).toBeVisible({ timeout: 30_000 })
  await documentRow.click()
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
}

type MarkingsBody = {
  baseVersionId?: string
  markings?: {
    documentKind?: string | null
    draft?: boolean
    privileged?: boolean
    withoutPrejudice?: boolean
  }
}

/**
 * Opens a ribbon tab and proves it selected before the caller touches the
 * panel's controls: a click that lands while the workspace re-renders its
 * toolbar (post-load, post-reload) can hit a detached trigger and silently
 * lose the activation.
 */
async function openRibbonTab(page: Page, name: 'Layout' | 'Review') {
  const tab = page.getByRole('tab', { name, exact: true }).first()
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await tab.click()
    const selected = await expect(tab)
      .toHaveAttribute('aria-selected', 'true', { timeout: 5_000 })
      .then(() => true)
      .catch(() => false)
    if (selected) return
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true')
}

test.use({ viewport: { width: 1440, height: 900 } })

test('markings commit as versions, persist, and ride both exports under a non-ASCII name', async ({
  page,
  request,
}) => {
  buildRichFixture()
  const { email, password } = await createAccount(request, 'e12-markings')
  await openUploadedDocument(page, email, password, {
    name: UNICODE_NAME,
    buffer: readFileSync(RICH_FIXTURE),
  })

  const markingsRequests: MarkingsBody[] = []
  page.on('request', (outgoing) => {
    if (/\/api\/documents\/[^/]+\/markings$/u.test(outgoing.url())) {
      markingsRequests.push(outgoing.postDataJSON() as MarkingsBody)
    }
  })

  const kind = page.getByLabel('Document type')
  const draft = page.getByRole('button', { name: 'Draft', exact: true })
  const privileged = page.getByRole('button', {
    name: 'Privileged',
    exact: true,
  })
  const withoutPrejudice = page.getByRole('button', {
    name: 'Without prejudice',
    exact: true,
  })
  await openRibbonTab(page, 'Layout')
  await expect(kind).toBeVisible()

  // Each change is its own immutable commit; the control must carry the
  // committed state back rather than a local paint.
  await kind.selectOption('particulars')
  await expect(kind).toHaveValue('particulars')
  await expect(kind).toBeEnabled()
  await draft.click()
  await expect(draft).toHaveAttribute('aria-pressed', 'true')
  await privileged.click()
  await expect(privileged).toHaveAttribute('aria-pressed', 'true')
  await expect(withoutPrejudice).toHaveAttribute('aria-pressed', 'false')

  // Three commits, each named against the head it replaced — the wire shape
  // the stale-base rule depends on.
  expect(markingsRequests).toHaveLength(3)
  expect(markingsRequests[0]?.markings?.documentKind).toBe('particulars')
  expect(markingsRequests[1]?.markings?.draft).toBe(true)
  expect(markingsRequests[2]?.markings?.privileged).toBe(true)
  expect(new Set(markingsRequests.map((body) => body.baseVersionId)).size).toBe(
    3,
  )

  // Stored, not painted: a reload reads the same markings back out of the
  // committed DOCX's custom properties.
  await page.reload({ waitUntil: 'networkidle' })
  await openRibbonTab(page, 'Layout')
  await expect(kind).toHaveValue('particulars', { timeout: 30_000 })
  await expect(draft).toHaveAttribute('aria-pressed', 'true')
  await expect(privileged).toHaveAttribute('aria-pressed', 'true')
  await expect(withoutPrejudice).toHaveAttribute('aria-pressed', 'false')

  // The standard export keeps the package's properties — the markings and
  // the foreign dms property alike — and names the file as uploaded.
  await openRibbonTab(page, 'Review')
  await expect(
    page.getByRole('button', { name: 'Export', exact: true }),
  ).toBeVisible()
  const [standardDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ])
  expect(standardDownload.suggestedFilename()).toBe(UNICODE_NAME)
  const standardPath = test.info().outputPath('export.docx')
  await standardDownload.saveAs(standardPath)
  const standard = inspectDocx(standardPath)
  const standardCustom = standard['docProps/custom.xml'] ?? ''
  expect(standardCustom).toContain('obiter.documentKind')
  expect(standardCustom).toContain('particulars')
  expect(standardCustom).toContain('obiter.draft')
  expect(standardCustom).toContain('obiter.privileged')
  expect(standardCustom).toContain('dms.matterRef')
  // The untouched export still carries what the upload carried.
  expect(standard['word/comments.xml']).toBeTruthy()
  expect(standard['word/document.xml']).toContain('commentReference')
  expect(standard['_xmlsignatures/sig1.xml']).toBeTruthy()

  // The share-safe export: the file is named for what it is, the markings
  // survive, and everything the policy strips is verifiably gone.
  const [shareDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Share-safe export' }).click(),
  ])
  const shareName = shareDownload.suggestedFilename()
  expect(shareName).toBe(UNICODE_NAME.replace('.docx', '-share-safe.docx'))
  const sharePath = test.info().outputPath('export-share-safe.docx')
  await shareDownload.saveAs(sharePath)
  const share = inspectDocx(sharePath)
  const shareCustom = share['docProps/custom.xml'] ?? ''
  expect(shareCustom).toContain('obiter.documentKind')
  expect(shareCustom).toContain('particulars')
  expect(shareCustom).toContain('obiter.privileged')
  expect(shareCustom).not.toContain('dms.matterRef')
  expect(share['word/comments.xml']).toBeUndefined()
  expect(share['word/document.xml']).not.toContain('commentReference')
  expect(share['word/document.xml']).not.toContain('commentRangeStart')
  expect(share['docProps/core.xml']).not.toContain('Alice Example')
  expect(
    Object.keys(share).some((part) => part.startsWith('_xmlsignatures/')),
  ).toBe(false)
  expect(share['word/settings.xml'] ?? '').not.toContain('trackRevisions')
})

test('a document redaction run returns its finalized copy as a new version', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request, 'e12-return')
  await openUploadedDocument(page, email, password, {
    name: 'e12-return.docx',
    buffer: readFileSync(fixturePath()),
  })

  // The ribbon entry reveals the document-level control rather than starting
  // a shadow run; the region's own button creates it.
  await openRibbonTab(page, 'Review')
  await page.getByLabel('Redact this document').click()
  const region = page.getByRole('region', { name: 'Redaction runs' })
  await expect(region).toBeFocused()
  await region.getByRole('button', { name: 'Redact this document' }).click()

  // Run creation opens the review screen; detection completes into a
  // reviewable state.
  await expect(page).toHaveURL(/\/redact\/red_/, { timeout: 30_000 })
  await expect(
    page.getByRole('button', { name: 'Finalize', exact: true }),
  ).toBeVisible({ timeout: 60_000 })

  // A returnable output is the editable DOCX, not the secure PDF.
  await page.getByRole('button', { name: 'Finalize', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Finalize redaction output' }),
  ).toBeVisible()
  await page.getByRole('radio', { name: /Pseudonymised editable copy/ }).check()
  const acknowledgements = page.getByRole('checkbox')
  for (let index = 0; index < (await acknowledgements.count()); index += 1) {
    await acknowledgements.nth(index).check()
  }
  await page.getByRole('button', { name: 'Create pseudonymised copy' }).click()

  // The finalized screen offers the return; committing it reports the new
  // version number against the source document.
  const returnButton = page.getByRole('button', {
    name: 'Return to document',
  })
  await expect(returnButton).toBeVisible({ timeout: 60_000 })
  await returnButton.click()
  await expect(page.getByText('Returned to document')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/Saved as version \d+ of the/)).toBeVisible()

  // The document link leads back; the new version sits on the document's
  // version list and the run no longer offers a second return.
  await page.getByRole('button', { name: 'Open document' }).click()
  await expect(page).toHaveURL(/\/documents\/doc_/, { timeout: 20_000 })
  await expect(
    page.getByRole('heading', { name: 'Versions', exact: true }),
  ).toBeVisible()
  await expect(page.getByText('v2 · e12-return.docx').first()).toBeVisible({
    timeout: 30_000,
  })
})
