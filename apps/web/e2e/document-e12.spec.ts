import { signIn } from './e13-support'
import {
  choose,
  menuItem,
  openMenu,
  openRibbonTab,
  runMenuCommand,
  selectedValue,
} from './editor-chrome'
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

const { apiOrigin, webOrigin, databaseName } = resolveJourneyTargets()
const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const RICH_FIXTURE = path.join('/tmp', 'e12-rich.docx')

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

const UNICODE_NAME = 'état des lieux — mémo.docx'
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function buildRichFixture() {
  rmSync(RICH_FIXTURE, { force: true })
  execFileSync('bun', ['-e', FIXTURE_SCRIPT], {
    cwd: `${REPO_ROOT}/packages/ooxml`,
    stdio: 'pipe',
  })
}

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

async function openTab(page: Page, name: 'Layout' | 'Review') {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const opened = await openRibbonTab(page, name)
      .then(() => true)
      .catch(() => false)
    if (opened) return
  }
  await openRibbonTab(page, name)
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

  const kind = selectedValue(page, 'Document type')
  const draft = page.getByRole('button', { name: 'Draft', exact: true })
  const privileged = page.getByRole('button', {
    name: 'Privileged',
    exact: true,
  })
  const withoutPrejudice = page.getByRole('button', {
    name: 'Without prejudice',
    exact: true,
  })
  await openTab(page, 'Layout')
  await expect(kind).toBeVisible()

  await choose(page, 'Document type', 'Particulars of claim')
  await expect(kind).toHaveText('Particulars of claim')
  await expect(kind).toBeEnabled()
  await draft.click()
  await expect(draft).toHaveAttribute('aria-pressed', 'true')
  await privileged.click()
  await expect(privileged).toHaveAttribute('aria-pressed', 'true')
  await expect(withoutPrejudice).toHaveAttribute('aria-pressed', 'false')

  expect(markingsRequests).toHaveLength(3)
  expect(markingsRequests[0]?.markings?.documentKind).toBe('particulars')
  expect(markingsRequests[1]?.markings?.draft).toBe(true)
  expect(markingsRequests[2]?.markings?.privileged).toBe(true)
  expect(new Set(markingsRequests.map((body) => body.baseVersionId)).size).toBe(
    3,
  )

  await page.reload({ waitUntil: 'networkidle' })
  await openTab(page, 'Layout')
  await expect(kind).toHaveText('Particulars of claim', { timeout: 30_000 })
  await expect(draft).toHaveAttribute('aria-pressed', 'true')
  await expect(privileged).toHaveAttribute('aria-pressed', 'true')
  await expect(withoutPrejudice).toHaveAttribute('aria-pressed', 'false')

  const [standardDownload] = await Promise.all([
    page.waitForEvent('download'),
    runMenuCommand(page, 'File', 'Export'),
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
  expect(standard['word/comments.xml']).toBeTruthy()
  expect(standard['word/document.xml']).toContain('commentReference')
  expect(standard['_xmlsignatures/sig1.xml']).toBeTruthy()

  const [shareDownload] = await Promise.all([
    page.waitForEvent('download'),
    runMenuCommand(page, 'File', 'Share-safe export'),
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

  await runMenuCommand(page, 'File', 'Redact this document')
  const region = page.getByRole('region', { name: 'Redaction runs' })
  await expect(region).toBeFocused()
  await region.getByRole('button', { name: 'Redact this document' }).click()

  await expect(page).toHaveURL(/\/redact\/red_/, { timeout: 30_000 })
  await expect(
    page.getByRole('button', { name: 'Finalise', exact: true }),
  ).toBeVisible({ timeout: 60_000 })

  const listbox = page.getByRole('listbox', { name: 'Detected spans' })
  await listbox.focus()
  const unreviewed = page.getByRole('tab', { name: /^Unreviewed/u })
  const total = Number(
    (await page.getByRole('tab', { name: /^All/u }).textContent())?.replace(
      /\D+/gu,
      '',
    ),
  )
  for (let index = 0; index < total; index += 1) {
    const before = Number(
      (await unreviewed.textContent())?.replace(/\D+/gu, ''),
    )
    if (before === 0) break
    await page.keyboard.press('Enter')
    await expect(
      page.getByRole('tab', { name: `Unreviewed ${before - 1}` }),
    ).toBeVisible({ timeout: 20_000 })
    await page.keyboard.press('ArrowDown')
  }
  await expect(unreviewed).toHaveText('Unreviewed 0', { timeout: 20_000 })

  await page.getByRole('button', { name: 'Finalise', exact: true }).click()
  await expect(
    page.getByRole('heading', { name: 'Finalise this redaction?' }),
  ).toBeVisible()
  await page.getByRole('radio', { name: /Pseudonymised Word/u }).check()
  const acknowledgements = page.getByRole('checkbox')
  for (let index = 0; index < (await acknowledgements.count()); index += 1) {
    await acknowledgements.nth(index).check()
  }
  await page
    .getByRole('button', { name: 'Finalise pseudonymised copy' })
    .click()

  const returnButton = page.getByRole('button', {
    name: 'Return to document',
  })
  await expect(returnButton).toBeVisible({ timeout: 60_000 })
  await returnButton.click()
  await expect(page.getByText('Saved to the matter')).toBeVisible({
    timeout: 30_000,
  })
  await expect(page.getByText(/Saved as version \d+ of the/)).toBeVisible()

  await page.getByRole('button', { name: 'Open document' }).click()
  await expect(page).toHaveURL(/\/documents\/doc_/, { timeout: 20_000 })
  await openMenu(page, 'File')
  await menuItem(page, 'Document information').click()
  const versionsPanel = page.getByRole('complementary', {
    name: 'Document information',
  })
  await expect(versionsPanel.getByText('Version 2').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(versionsPanel.getByText('Current version')).toBeVisible()
})
