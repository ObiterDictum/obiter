import { mkdir, writeFile } from 'node:fs/promises'

const outputDirectory = new URL('../data/evals/redact/', import.meta.url)

function escapePdfText(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

function createPdf(pages) {
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    `<< /Type /Pages /Kids [${pages.map((_, index) => `${index * 2 + 3} 0 R`).join(' ')}] /Count ${pages.length} >>`,
  ]

  for (let index = 0; index < pages.length; index += 1) {
    const pageObject = index * 2 + 3
    const contentObject = pageObject + 1
    const lines = pages[index]
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
      `<< /Type /Page /Parent 2 0 R /Resources << /Font << /F1 ${pages.length * 2 + 3} 0 R >> >> /MediaBox [0 0 612 792] /Contents ${contentObject} 0 R >>`,
      `<< /Length ${Buffer.byteLength(content)} >>\nstream\n${content}\nendstream`,
    )
  }

  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>')
  let pdf = '%PDF-1.4\n'
  const offsets = [0]
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  }
  const xrefOffset = Buffer.byteLength(pdf)
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  pdf += offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`)
    .join('')
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf)
}

await mkdir(outputDirectory, { recursive: true })
await writeFile(
  new URL('pdf-text-layer-fixture.pdf', outputDirectory),
  createPdf([
    [
      'Mr Amina Rahman',
      'Email: amina.rahman@example.test',
      'NI: QQ 12 34 56 C',
    ],
    ['Please contact Mr Amina Rahman about this matter.'],
  ]),
)
await writeFile(
  new URL('pdf-short-text-layer-fixture.pdf', outputDirectory),
  createPdf([['Brief note.']]),
)
await writeFile(
  new URL('pdf-low-text-multipage-fixture.pdf', outputDirectory),
  createPdf([['Short'], ['note']]),
)
await writeFile(
  new URL('pdf-scanned-like-fixture.pdf', outputDirectory),
  createPdf([[]]),
)
