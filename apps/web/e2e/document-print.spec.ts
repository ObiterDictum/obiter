import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { mockSession } from './shell-harness'

/**
 * Headless proof that Print uses the document state on screen.
 *
 * The synthetic DOCX carries an unsaved edit, a pending inserted paragraph, a
 * deleted paragraph and a table, and the compressed PDF is read back through
 * unpdf so the assertions are about what a printer would receive, not the DOM
 * alone. No print job leaves the machine: `page.pdf()` renders the print media
 * in-process.
 */

const MATTER = {
  id: 'mtr_print',
  organisationId: 'org_shell_test',
  name: 'Print Matter',
  description: null,
  primaryJurisdiction: 'england-and-wales',
  secondaryJurisdictions: [],
  legalDomains: [],
  clientReference: '',
  status: 'active',
  createdBy: 'usr_shell_test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  deletedAt: null,
  deletedBy: null,
}

const VERSION = {
  id: 'ver_1',
  organisationId: 'org_shell_test',
  matterId: 'mtr_print',
  matterDocumentId: 'doc_print',
  filename: 'print-fixture.docx',
  fileType: 'docx',
  sizeBytes: '1024',
  objectKey: 'objects/doc_print/ver_1',
  textObjectKey: null,
  documentStatus: 'ready',
  failureReason: null,
  versionNumber: 1,
  contentSha256: 'a'.repeat(64),
  syncState: 'synced',
  createdBy: 'usr_shell_test',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
}

const TABLE_XML =
  '<w:tbl><w:tr><w:tc><w:p w14:paraId="CELL0001"><w:r><w:t>Cell one</w:t></w:r></w:p></w:tc><w:tc><w:p w14:paraId="CELL0002"><w:r><w:t>Cell two</w:t></w:r></w:p></w:tc></w:tr></w:tbl>'

function paragraph(id: string, text: string) {
  return {
    id,
    runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
}

/** Enough body text that the engine paginates past one printed sheet. */
const BODY_PARAGRAPHS = Array.from({ length: 70 }, (_, index) =>
  paragraph(
    `p${String(index + 1)}`,
    `Paragraph ${String(index + 1)} of the print fixture.`,
  ),
)

const MODEL = {
  documentId: 'doc_print',
  versionId: 'ver_1',
  versionNumber: 1,
  model: {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          ...BODY_PARAGRAPHS,
          paragraph('CELL0001', 'Cell one'),
          paragraph('CELL0002', 'Cell two'),
          paragraph('p-last', 'Closing paragraph.'),
        ],
        preservedXmlFragments: [TABLE_XML],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  },
}

async function mockWorkspace(page: Page) {
  await page.route('**/api/matters', (route) =>
    route.fulfill({ json: { matters: [MATTER] } }),
  )
  await page.route('**/api/matters/mtr_print', (route) =>
    route.fulfill({ json: { matter: MATTER } }),
  )
  await page.route('**/api/matters/mtr_print/documents', (route) =>
    route.fulfill({
      json: {
        documents: [
          {
            id: 'doc_print',
            organisationId: 'org_shell_test',
            matterId: 'mtr_print',
            currentVersionId: 'ver_1',
            logicalKey: 'print-fixture.docx',
            createdBy: 'usr_shell_test',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
            deletedAt: null,
            deletedBy: null,
            currentVersion: VERSION,
          },
        ],
      },
    }),
  )
  await page.route('**/api/documents/doc_print/model', (route) =>
    route.fulfill({ json: MODEL }),
  )
  await page.route('**/api/documents/doc_print/comments', (route) =>
    route.fulfill({
      json: { comments: [], importedComments: [], orphanedReplies: [] },
    }),
  )
  await page.route('**/api/documents/doc_print/tracked-changes', (route) =>
    route.fulfill({ json: { changes: [] } }),
  )
  await page.route('**/api/documents/doc_print/collaboration/sync*', (route) =>
    route.fulfill({
      json: { changed: false, participants: [], currentVersionId: 'ver_1' },
    }),
  )
  await page.route(
    '**/api/documents/doc_print/collaboration/presence',
    (route) => route.fulfill({ json: {} }),
  )
}

/**
 * Reach the document workspace through the app. The matter/document loaders
 * guard during SSR, where a mocked session does not apply, so a direct
 * `page.goto` would serve the sign-in page; client-side navigation from the
 * public search route runs those loaders in the browser, where the mocks apply.
 */
async function openWorkspace(page: Page) {
  await page.goto('/search')
  const modes = page.getByRole('navigation', { name: 'Modes' })
  await expect(modes).toBeVisible()
  await modes.getByRole('link', { name: 'Matters' }).first().click()
  await page
    .getByRole('main')
    .getByRole('link', { name: /Print Matter/ })
    .click()
  await page.getByRole('button', { name: /print-fixture\.docx/ }).click()
  await expect(page.locator('[data-document-desk]')).toBeVisible()
}

/** Read the generated PDF back through PDF.js (via unpdf) from the API package. */
function readPdf(pdfPath: string) {
  const script = `
    import { getDocumentProxy, extractText } from 'unpdf'
    import { readFile } from 'node:fs/promises'
    const bytes = await readFile(process.env.OBITER_PDF_PATH)
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const result = await extractText(pdf, { mergePages: false })
    process.stdout.write(JSON.stringify({ totalPages: result.totalPages, pages: result.text }))
  `
  const stdout = execFileSync('bun', ['-e', script], {
    cwd: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../services/api',
    ),
    env: { ...process.env, OBITER_PDF_PATH: pdfPath },
    encoding: 'utf8',
  })
  return JSON.parse(stdout) as { totalPages: number; pages: string[] }
}

test('Print renders the on-screen state, including unsaved edits and tables', async ({
  page,
}) => {
  await mockSession(page)
  await mockWorkspace(page)
  await openWorkspace(page)

  const desk = page.locator('[data-document-desk]')
  await expect(desk).toContainText('Paragraph 1 of the print fixture.')

  // Unsaved formatting and text on paragraph 1.
  await page.getByText('Paragraph 1 of the print fixture.').first().click()
  await page.getByRole('button', { name: 'Bold' }).click()
  const editor = page.getByLabel('Paragraph text')
  await editor.fill('Edited paragraph one')

  // A pending inserted paragraph, typed but never saved.
  await editor.press('Enter')
  await page.getByLabel('Pending paragraph text').fill('Inserted paragraph')

  // A deleted paragraph: select paragraph 2 and delete it from the ribbon.
  await page.getByText('Paragraph 2 of the print fixture.').first().click()
  await page.getByRole('button', { name: 'Delete paragraph' }).click()
  await expect(desk).not.toContainText('Paragraph 2 of the print fixture.')

  // The page rule is the document's own page box, not an assumed A4.
  expect(
    await page
      .locator('style[data-document-print]')
      .evaluate((element) => element.textContent),
  ).toBe('@page{size:8.2708in 11.6979in;margin:0}')

  // Print media: chrome is out, the painted document (drafts included) stays.
  await page.emulateMedia({ media: 'print' })
  await expect(page.getByRole('tab', { name: 'Review' })).toBeHidden()
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden()
  await expect(desk).toContainText('Edited paragraph one')
  await expect(desk).toContainText('Inserted paragraph')
  await expect(desk).toContainText('Cell one')
  await expect(desk).toContainText('Cell two')
  // The pending insert prints from static content; the form control it is
  // edited in is not part of the printed sheet.
  await expect(page.getByLabel('Pending paragraph text')).toBeHidden()
  await expect(desk.locator('[data-pending-insert-print]')).toBeVisible()

  const sheetCount = await page.locator('[data-document-sheet]').count()
  expect(sheetCount).toBeGreaterThan(1)

  const pdfPath = test.info().outputPath('document-print.pdf')
  await page.pdf({
    path: pdfPath,
    preferCSSPageSize: true,
    printBackground: true,
  })
  const pdf = readPdf(pdfPath)
  expect(pdf.totalPages).toBe(sheetCount)

  const printed = pdf.pages.join('\n')
  expect(printed).toContain('Edited paragraph one')
  expect(printed).toContain('Inserted paragraph')
  expect(printed).toContain('Cell one')
  expect(printed).toContain('Closing paragraph.')
  expect(printed).not.toContain('Paragraph 2 of the print fixture.')
})

test('the Print control reports an absent print capability', async ({
  page,
}) => {
  await mockSession(page)
  await mockWorkspace(page)
  // Remove the platform print entry point before the app mounts so the control
  // must surface the absence rather than look inert.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'print', {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })
  await openWorkspace(page)
  await page.getByRole('tab', { name: 'Review' }).click()
  await page.getByRole('button', { name: 'Print', exact: true }).click()
  await expect(
    page.getByText('Printing is not available in this environment.'),
  ).toBeVisible()
})
