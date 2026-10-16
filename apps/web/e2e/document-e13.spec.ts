import { expect, test } from '@playwright/test'
import {
  createAccount,
  editor,
  focusParagraph,
  HEADING,
  openDocx,
  openMatterDocument,
  openRibbonTab,
  signIn,
} from './e13-support'

/*
 * E13 browser coverage, view family: the View ribbon's real controls (web
 * layout, ruler, navigation pane, spelling), DOCX zoom, and the PDF viewer's
 * controls with its bounded per-page mounting. Draft-recovery, save-state
 * and accessibility coverage live in the sibling spec files this family's
 * shared helpers in e13-support.ts serve.
 */

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

  // Out-of-range jumps are refused, not clamped silently, and the field
  // returns to the page actually being shown.
  await jump.fill('99')
  await jump.press('Enter')
  await expect(page.getByText('page 24 line 1 token-23')).toBeVisible()
  await expect(jump).toHaveValue('24')

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
