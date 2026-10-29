import { execFileSync } from 'node:child_process'
import { readFileSync, rmSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test } from '@playwright/test'
import {
  createAccount,
  focusParagraph,
  openDocx,
  openMatterDocument,
  openFind,
  saveAndWait,
  signIn,
} from './e13-support'
import { runMenuCommand } from './editor-chrome'

test.use({ viewport: { width: 1440, height: 900 } })

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.resolve(HERE, '..', '..', '..')
const UNICODE_FIXTURE = path.join('/tmp', 'e14-unicode.docx')
const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

function escapePdfText(value: string) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

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

const UNICODE_DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p><w:r><w:t xml:space="preserve">ΟΔΟΣ means street</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">cafe&#x301; au lait</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">A 𝕏 mark</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">prelude marker</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">marker middle</w:t></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> REF BM1 </w:instrText></w:r></w:p>
    <w:p><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:t xml:space="preserve">field tail</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">also marker</w:t></w:r></w:p>
    <w:p><w:r><w:t xml:space="preserve">marker tail</w:t></w:r></w:p>
    <w:sectPr/>
  </w:body>
</w:document>
`

function buildUnicodeFixture() {
  rmSync(UNICODE_FIXTURE, { force: true })
  execFileSync(
    'bun',
    [
      '-e',
      `const { default: JSZip } = await import('jszip')
       const zip = new JSZip()
       zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>')
       zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>')
       zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>')
       zip.file('word/styles.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>')
       zip.file('word/document.xml', ${JSON.stringify(UNICODE_DOCUMENT_XML)})
       await Bun.write('${UNICODE_FIXTURE}', await zip.generateAsync({ type: 'uint8array' }))`,
    ],
    { cwd: `${REPO_ROOT}/packages/ooxml`, stdio: 'pipe' },
  )
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

test('DOCX find navigates, replaces across a paragraph break, saves and reloads', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E14 find ${Date.now()}`)
  await openFind(page)

  const findField = page.getByLabel('Find in document')
  const status = page.getByRole('status').filter({ hasText: /found|\// })

  await findField.fill('paragraph')
  await expect(status).toHaveText('3 found')

  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(status).toHaveText('1/3')
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(status).toHaveText('2/3')
  await page.getByRole('button', { name: 'Previous match' }).click()
  await expect(status).toHaveText('1/3')

  await findField.fill('para')
  await expect(status).toHaveText('3 found')
  await page.getByRole('button', { name: 'Whole word' }).click()
  await expect(status).toHaveText('0 found')
  await page.getByRole('button', { name: 'Whole word' }).click()

  await findField.fill('e4 heading')
  await expect(status).toHaveText('1 found')
  await page.getByRole('button', { name: 'Match case' }).click()
  await expect(status).toHaveText('0 found')
  await findField.fill('E4 Heading')
  await expect(status).toHaveText('1 found')
  await page.getByRole('button', { name: 'Match case' }).click()

  await findField.fill('paragraph Delta')
  await expect(status).toHaveText('1 found')
  await page.getByLabel('Replace in document').fill('paragraph — the last')
  await page.getByRole('button', { name: 'Replace all' }).click()
  await expect(
    page.locator('[data-paragraph-id]', {
      hasText: 'Gamma paragraph — the last paragraph',
    }),
  ).toHaveCount(1)

  await findField.fill('Beta paragraph')
  await expect(status).toHaveText('1 found')
  await page.getByLabel('Replace in document').fill('Beta clause')
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta clause' }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Alpha item' }),
  ).toHaveCount(1)

  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta paragraph' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta clause' }),
  ).toHaveCount(1)

  await saveAndWait(page)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta clause' }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', {
      hasText: 'Gamma paragraph — the last paragraph',
    }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta paragraph' }),
  ).toHaveCount(0)

  await focusParagraph(page, 'Beta clause')
  await page.keyboard.press('Control+f')
  await expect(page.getByLabel('Find in document')).toBeFocused()
})

test('PDF find navigates to the hit page and highlights the active slice', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  const pdf = buildPdf(
    Array.from({ length: 24 }, (_, index) =>
      Array.from(
        { length: 10 },
        (__, row) => `E14 page ${index + 1} line ${row + 1} token-${index}`,
      ),
    ),
  )
  await signIn(page, email, password)
  await openMatterDocument(page, `E14 pdf ${Date.now()}`, {
    name: 'e14-find.pdf',
    mimeType: 'application/pdf',
    buffer: pdf,
  })
  await expect(page.getByText('View only, not editable')).toBeVisible({
    timeout: 60_000,
  })
  await expect(page.getByText('page 1 line 1 token-0')).toBeVisible({
    timeout: 60_000,
  })

  const findField = page.getByLabel('Find in document')
  await expect(page.getByLabel('Replace in document')).toHaveCount(0)

  await findField.fill('token-3')
  await expect(
    page.getByRole('status').filter({ hasText: 'found' }),
  ).toHaveText('10 found')
  await expect(page.getByText('page 1 line 1 token-0')).toBeVisible()

  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(page.getByText('page 4 line 1 token-3')).toBeVisible()
  await expect(page.getByText('page 1 line 1 token-0')).toHaveCount(0)
  await expect(
    page.locator('[data-pdf-find-slice="active"]').first(),
  ).toBeVisible()
  expect(
    await page.locator('[data-pdf-find-slice="hit"]').count(),
  ).toBeGreaterThan(0)

  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(page.getByText('page 4 line 2 token-3')).toBeVisible()

  await findField.fill('token-2')
  await expect(
    page.getByRole('status').filter({ hasText: 'found' }),
  ).toHaveText('50 found')
  await page.getByRole('button', { name: 'Previous match' }).click()
  await expect(page.getByText('page 24 line 10 token-23')).toBeVisible()
  await expect(page.getByText('page 4 line 2 token-3')).toHaveCount(0)
  await expect(
    page.locator('[data-pdf-find-slice="active"]').first(),
  ).toBeVisible()

  await page.getByRole('button', { name: 'Match case' }).click()
  await findField.fill('TOKEN-3')
  await expect(
    page.getByRole('status').filter({ hasText: 'found' }),
  ).toHaveText('0 found')
  await page.getByRole('button', { name: 'Match case' }).click()

  await page.getByRole('button', { name: 'Previous page' }).click()
  await expect(page.getByText('page 23 line 1 token-22')).toBeVisible()
  await page.getByRole('button', { name: 'Next page' }).click()
  await expect(page.getByText('page 24 line 1 token-23')).toBeVisible()
  await expect(page.locator('body')).toBeFocused()
  await page.keyboard.press('Control+f')
  await expect(findField).toBeFocused()
})

test('DOCX find folds Unicode, refuses a protected range, and exports the result', async ({
  page,
  request,
}) => {
  buildUnicodeFixture()
  const { email, password } = await createAccount(request)
  await signIn(page, email, password)
  await openMatterDocument(page, `E14 unicode ${Date.now()}`, {
    name: 'e14-unicode.docx',
    mimeType: DOCX_MIME,
    buffer: readFileSync(UNICODE_FIXTURE),
  })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await openFind(page)

  const findField = page.getByLabel('Find in document')
  const status = page.getByRole('status').filter({ hasText: /found|\// })
  const notice = page.locator('[data-selection-status]')

  await findField.fill('οδος')
  await expect(status).toHaveText('1 found')
  await findField.fill('ΟΔΟΣ')
  await expect(status).toHaveText('1 found')

  await findField.fill('οδο')
  await expect(status).toHaveText('1 found')
  await page.getByRole('button', { name: 'Whole word' }).click()
  await expect(status).toHaveText('0 found')
  await page.getByRole('button', { name: 'Whole word' }).click()

  await page.getByRole('button', { name: 'Match case' }).click()
  await findField.fill('οδος')
  await expect(status).toHaveText('0 found')
  await findField.fill('ΟΔΟΣ')
  await expect(status).toHaveText('1 found')
  await page.getByRole('button', { name: 'Match case' }).click()

  await findField.fill('café')
  await expect(status).toHaveText('1 found')
  await findField.fill('𝕏')
  await expect(status).toHaveText('1 found')

  await findField.fill('marker marker')
  await expect(status).toHaveText('2 found')
  await page.getByLabel('Replace in document').fill('joined')
  await page.getByRole('button', { name: 'Replace all' }).click()
  await expect(notice).toContainText(
    'cannot be replaced because it crosses a table, a text box, or a stored field boundary',
  )
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'marker middle' }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'marker tail' }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'joined' }),
  ).toHaveCount(0)

  await page.getByRole('button', { name: 'Next match' }).click()
  await page.getByRole('button', { name: 'Next match' }).click()
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'also joined tail' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'also marker' }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'marker tail' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'also joined tail' }),
  ).toHaveCount(1)
  await openFind(page)

  await findField.fill('οδος')
  await expect(status).toHaveText('1 found')
  await page.getByLabel('Replace in document').fill('ΠΟΛΗ')
  await page.getByRole('button', { name: 'Replace', exact: true }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'ΠΟΛΗ means street' }),
  ).toHaveCount(1)

  await saveAndWait(page)
  await page.reload({ waitUntil: 'networkidle' })
  await expect(page.locator('[data-paragraph-id]').first()).toBeVisible({
    timeout: 30_000,
  })
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'ΠΟΛΗ means street' }),
  ).toHaveCount(1)
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'also joined tail' }),
  ).toHaveCount(1)

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    runMenuCommand(page, 'File', 'Export'),
  ])
  const exportPath = test.info().outputPath('e14-export.docx')
  await download.saveAs(exportPath)
  const documentXml = zipPart(exportPath, 'word/document.xml')
  expect(documentXml).toContain('ΠΟΛΗ means street')
  expect(documentXml).toContain('also joined tail')
  expect(documentXml).not.toContain('ΟΔΟΣ means street')
  expect(documentXml).toContain('w:fldCharType="begin"')
  expect(documentXml).toContain('w:fldCharType="end"')
  expect(documentXml).toContain(' REF BM1 ')
})
