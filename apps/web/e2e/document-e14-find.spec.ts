import { expect, test } from '@playwright/test'
import {
  createAccount,
  focusParagraph,
  openDocx,
  openMatterDocument,
  openRibbonTab,
  saveAndWait,
  signIn,
} from './e13-support'

/*
 * E14 browser coverage: the complete find/replace journey on a DOCX —
 * literal matching with match-case and whole-word options, a hit that
 * crosses a paragraph break, replace-one and replace-all through the real
 * save pipeline, and persistence across a reload. The second journey runs
 * find against a real uploaded PDF: page-indexed hits, active-hit reveal
 * and the bounded one-page mounting the viewer keeps.
 */

test.use({ viewport: { width: 1440, height: 900 } })

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

test('DOCX find navigates, replaces across a paragraph break, saves and reloads', async ({
  page,
  request,
}) => {
  const { email, password } = await createAccount(request)
  await openDocx(page, email, password, `E14 find ${Date.now()}`)
  await openRibbonTab(page, 'Review')

  const findField = page.getByLabel('Find in document')
  const status = page.getByRole('status').filter({ hasText: /found|\// })

  // Literal find over the fixture's three '… paragraph' lines.
  await findField.fill('paragraph')
  await expect(status).toHaveText('3 found')

  // Next/Previous move the active index and wrap; the count stays live.
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(status).toHaveText('1/3')
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(status).toHaveText('2/3')
  await page.getByRole('button', { name: 'Previous match' }).click()
  await expect(status).toHaveText('1/3')

  // Whole word narrows the same query honestly: 'para' inside 'paragraph'
  // is not a word.
  await findField.fill('para')
  await expect(status).toHaveText('3 found')
  await page.getByRole('button', { name: 'Whole word' }).click()
  await expect(status).toHaveText('0 found')
  await page.getByRole('button', { name: 'Whole word' }).click()

  // Match case is real: 'e4 heading' folds, 'E4 Heading' with case on does
  // not match the lowercase query…
  await findField.fill('e4 heading')
  await expect(status).toHaveText('1 found')
  await page.getByRole('button', { name: 'Match case' }).click()
  await expect(status).toHaveText('0 found')
  // …and the stored casing does.
  await findField.fill('E4 Heading')
  await expect(status).toHaveText('1 found')
  await page.getByRole('button', { name: 'Match case' }).click()

  // A hit that crosses the paragraph break: 'Gamma paragraph' then 'Delta
  // paragraph' are adjacent paragraphs, and the query's space covers the
  // break. Replace-all joins the range through the document's own range
  // edit — the hit, the break and the replaced range are the same range.
  await findField.fill('paragraph Delta')
  await expect(status).toHaveText('1 found')
  await page.getByLabel('Replace in document').fill('paragraph — the last')
  await page.getByRole('button', { name: 'Replace all' }).click()
  await expect(
    page.locator('[data-paragraph-id]', {
      hasText: 'Gamma paragraph — the last paragraph',
    }),
  ).toHaveCount(1)

  // Replace-one on the next query; the untouched text stays untouched.
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

  // Undo is one logical step for the replace: the batch rewinds together.
  await openRibbonTab(page, 'Home')
  await page.getByRole('button', { name: 'Undo' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta paragraph' }),
  ).toHaveCount(1)
  await page.getByRole('button', { name: 'Redo' }).click()
  await expect(
    page.locator('[data-paragraph-id]', { hasText: 'Beta clause' }),
  ).toHaveCount(1)

  // Save through the real pipeline, reload, and the replaced text persists.
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

  // Ctrl/Cmd+F routes to the find field from the document surface.
  await openRibbonTab(page, 'Review')
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
    Array.from({ length: 6 }, (_, index) =>
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

  // Find on a read-only surface offers search but never a replace it cannot
  // honour.
  const findField = page.getByLabel('Find in document')
  await expect(page.getByLabel('Replace in document')).toHaveCount(0)

  // 'token-3' lives on page 4 — one hit per line, ten lines.
  await findField.fill('token-3')
  await expect(
    page.getByRole('status').filter({ hasText: 'found' }),
  ).toHaveText('10 found')
  // Nothing navigates until the user asks: page 1 stays mounted.
  await expect(page.getByText('page 1 line 1 token-0')).toBeVisible()

  await page.getByRole('button', { name: 'Next match' }).click()
  // The viewer revealed the hit's page — and only that page: mounting stays
  // bounded to one page the way the viewer always was.
  await expect(page.getByText('page 4 line 1 token-3')).toBeVisible()
  await expect(page.getByText('page 1 line 1 token-0')).toHaveCount(0)
  await expect(
    page.locator('[data-pdf-find-slice="active"]').first(),
  ).toBeVisible()
  expect(
    await page.locator('[data-pdf-find-slice="hit"]').count(),
  ).toBeGreaterThan(0)

  // Later hits stay on the same page until the query's hits end.
  await page.getByRole('button', { name: 'Next match' }).click()
  await expect(page.getByText('page 4 line 2 token-3')).toBeVisible()

  // Match case applies on the PDF surface too: lowercase never matches the
  // stored token.
  await page.getByRole('button', { name: 'Match case' }).click()
  await findField.fill('TOKEN-3')
  await expect(
    page.getByRole('status').filter({ hasText: 'found' }),
  ).toHaveText('0 found')
  await page.getByRole('button', { name: 'Match case' }).click()

  // Ctrl/Cmd+F routes to the workspace find on the PDF surface, the way the
  // document workspace routes it — the browser's own find is not the tool
  // for a bounded viewer.
  await page.getByRole('button', { name: 'Next page' }).click()
  await page.keyboard.press('Control+f')
  await expect(findField).toBeFocused()
})
