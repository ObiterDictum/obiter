import { mkdir, writeFile } from 'node:fs/promises'

const outputDirectory = new URL('../data/evals/redact/', import.meta.url)

function escapePdfText(value) {
  return value
    .replaceAll('\\', '\\\\')
    .replaceAll('(', '\\(')
    .replaceAll(')', '\\)')
}

function pdfText(value) {
  if (![...value].some((character) => character.codePointAt(0) > 0x7f))
    return `(${escapePdfText(value)})`
  return `<FEFF${Buffer.from(value, 'utf16le').swap16().toString('hex').toUpperCase()}>`
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
        `${pdfText(line)} Tj`,
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
  new URL('pdf-spaced-pii-fixture.pdf', outputDirectory),
  createPdf([
    ['Q Q 1 2 3 4 5 6 C', 'a m i n a @ e x a m p l e . t e s t', 'I am a QC'],
  ]),
)
await writeFile(
  new URL('pdf-zero-width-scanned-fixture.pdf', outputDirectory),
  createPdf([['\u200B'.repeat(30)], ['\u200B'.repeat(30)]]),
)
await writeFile(
  new URL('pdf-scanned-like-fixture.pdf', outputDirectory),
  createPdf([[]]),
)

// P2.25 claim-form pair (synthetic reproductions of the lost /tmp probe,
// never real legal text): the same all-caps lines once with real spaces
// and once with inter-word spaces stripped at the content level — the
// byte-level equivalent of zero inter-word advance, which renders with no
// gaps so extraction sees no boundaries either way. Pre-fix, the spaced
// form collapsed to INTHECOUNTY COURTATCENTRAL LONDON / PARTICULARSOFCLAIM
// (letter-run signal); post-fix it extracts clean, while the fused form
// still extracts fused (token signal). Written to the upload corpus next
// to the P2.24 .docx fixtures so upload/coverage tests stay hermetic.
const uploadCorpusDirectory = new URL(
  '../services/api/test-fixtures/upload-corpus/',
  import.meta.url,
)
const claimFormLines = [
  'IN THE COUNTY COURT AT CENTRAL LONDON',
  'PARTICULARS OF CLAIM',
  'The Claimant claims damages totalling GBP 162,526.25',
  'NI number QQ 12 34 56 C was recorded',
]
await mkdir(uploadCorpusDirectory, { recursive: true })
await writeFile(
  new URL('claim-form-spaced.pdf', uploadCorpusDirectory),
  createPdf([claimFormLines]),
)
await writeFile(
  new URL('claim-form-fused.pdf', uploadCorpusDirectory),
  createPdf([claimFormLines.map((line) => line.replaceAll(' ', ''))]),
)
