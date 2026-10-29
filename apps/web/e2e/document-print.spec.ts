import { execFileSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { test, expect, type Page } from '@playwright/test'
import { mockSession } from './shell-harness'
import { closeMenu, menuItem, openMenu, runMenuCommand } from './editor-chrome'

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
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
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
  await page.route('**/api/documents/doc_print', (route) =>
    route.fulfill({
      json: {
        document: {
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
        versions: [VERSION],
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

async function openWorkspace(page: Page) {
  await page.goto('/search')
  const nav = page.getByRole('navigation', { name: 'Workspace' })
  await expect(nav).toBeVisible()
  await nav.getByRole('link', { name: 'Matters' }).first().click()
  await page
    .getByRole('main')
    .getByRole('link', { name: /Print Matter/ })
    .click()
  await page
    .getByRole('link', { name: /print-fixture\.docx/ })
    .first()
    .click()
  await expect(page.locator('[data-document-desk]')).toBeVisible()
}

function readPdf(pdfPath: string) {
  const script = `
    import { getDocumentProxy, extractText } from 'unpdf'
    import { readFile } from 'node:fs/promises'
    const bytes = await readFile(process.env.OBITER_PDF_PATH)
    const pdf = await getDocumentProxy(new Uint8Array(bytes))
    const result = await extractText(pdf, { mergePages: false })
    const sizes = []
    for (let index = 1; index <= pdf.numPages; index += 1) {
      const pdfPage = await pdf.getPage(index)
      const viewport = pdfPage.getViewport({ scale: 1 })
      sizes.push({ width: viewport.width, height: viewport.height })
    }
    process.stdout.write(JSON.stringify({ totalPages: result.totalPages, pages: result.text, sizes }))
  `
  const stdout = execFileSync('bun', ['-e', script], {
    cwd: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../services/api',
    ),
    env: { ...process.env, OBITER_PDF_PATH: pdfPath },
    encoding: 'utf8',
  })
  return JSON.parse(stdout) as {
    totalPages: number
    pages: string[]
    sizes: { width: number; height: number }[]
  }
}

test('Print renders the on-screen state, including unsaved edits and tables', async ({
  page,
}) => {
  await mockSession(page)
  await mockWorkspace(page)
  await openWorkspace(page)

  const desk = page.locator('[data-document-desk]')
  await expect(desk).toContainText('Paragraph 1 of the print fixture.')

  await page.getByText('Paragraph 1 of the print fixture.').first().click()
  await page.getByRole('button', { name: 'Bold' }).click()
  const editor = page.getByLabel('Paragraph text')
  await editor.fill('Edited paragraph one')

  await editor.press('Enter')
  await page.getByLabel('Pending paragraph text').fill('Inserted paragraph')

  await page.getByText('Paragraph 2 of the print fixture.').first().click()
  await runMenuCommand(page, 'Edit', 'Delete paragraph')
  await expect(desk).not.toContainText('Paragraph 2 of the print fixture.')

  expect(
    await page
      .locator('style[data-document-print]')
      .evaluate((element) => element.textContent),
  ).toBe('@page{size:8.2708in 11.6979in;margin:0}')

  await page.getByRole('button', { name: 'Comments', exact: true }).click()

  await page.emulateMedia({ media: 'print' })
  await expect(
    page.getByRole('toolbar', { name: 'Document toolbar' }),
  ).toBeHidden()
  await expect(page.getByRole('button', { name: 'Save' })).toBeHidden()
  await expect(page.locator('[data-print-hide]')).toBeHidden()
  await expect(desk).toContainText('Edited paragraph one')
  await expect(desk).toContainText('Inserted paragraph')
  await expect(desk).toContainText('Cell one')
  await expect(desk).toContainText('Cell two')
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

test('printing from the web layout paginates onto the stored paper size', async ({
  page,
}) => {
  await mockSession(page)
  await mockWorkspace(page)
  await openWorkspace(page)

  await openMenu(page, 'View')
  await menuItem(page, 'Web layout').click()
  await closeMenu(page)
  await expect(page.locator('[data-document-sheet]')).toHaveCount(1)
  expect(
    await page
      .locator('style[data-document-print]')
      .evaluate((element) => element.textContent),
  ).toBe('@page{size:8.2708in 11.6979in;margin:0}')

  const pdfPath = test.info().outputPath('document-print-web.pdf')
  await page.pdf({
    path: pdfPath,
    preferCSSPageSize: true,
    printBackground: true,
  })
  const pdf = readPdf(pdfPath)

  expect(pdf.totalPages).toBeGreaterThan(1)
  for (const size of pdf.sizes) {
    expect(Math.abs(size.width - 595.28)).toBeLessThan(1)
    expect(Math.abs(size.height - 841.89)).toBeLessThan(1)
  }

  const printed = pdf.pages.join('\n')
  expect(printed).toContain('Paragraph 1 of the print fixture.')
  expect(printed).toContain('Closing paragraph.')
})

test('the Print control reports an absent print capability', async ({
  page,
}) => {
  await mockSession(page)
  await mockWorkspace(page)
  await page.addInitScript(() => {
    Object.defineProperty(window, 'print', {
      value: undefined,
      configurable: true,
      writable: true,
    })
  })
  await openWorkspace(page)
  await runMenuCommand(page, 'File', 'Print')
  await expect(
    page.getByText('Printing is not available in this environment.'),
  ).toBeVisible()
})
