import { PDFDocument, StandardFonts } from 'pdf-lib'

export function rawFreeTextPdf() {
  const rect: [number, number, number, number] = [300, 500, 450, 540]
  const width = rect[2] - rect[0]
  const height = rect[3] - rect[1]
  return {
    bytes: rawPdf([
      '<< /Type /Catalog /Pages 2 0 R >>',
      '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
      '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R /Annots [5 0 R] >>',
      pdfStream('BT /F1 12 Tf 1 0 0 1 60 700 Tm (BODYTEXT) Tj ET'),
      `<< /Type /Annot /Subtype /FreeText /Rect [${rect.join(' ')}] /AP << /N 6 0 R >> /F 4 >>`,
      pdfStream(
        'BT /F1 12 Tf 1 0 0 1 2 4 Tm (SECRETVALUE) Tj ET',
        `/Type /XObject /Subtype /Form /BBox [0 0 ${width} ${height}] /Resources << /Font << /F1 7 0 R >> >>`,
      ),
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    ]),
    rect: { x: rect[0], y: rect[1], width, height },
  }
}

/** Line advances pdf-lib cannot emit: T*, quote and double-quote rewrites. */
export function rawNextLinePdf() {
  return rawType1Pdf(
    'BT /F1 12 Tf 14 TL 1 0 0 1 60 700 Tm (Line1) Tj T* (Line2) Tj ET ' +
      "BT /F1 12 Tf 14 TL 1 0 0 1 60 600 Tm (Row1) Tj (Row2) ' ET " +
      'BT /F1 12 Tf 14 TL 1 0 0 1 60 500 Tm (Pair1) Tj 0 0 (Pair2) " ET',
  )
}

/**
 * One-page pdf-lib PDF: body text plus a text field holding `value`.
 * Coordinates use the pdf-lib origin (bottom-left).
 */
export async function textFieldPdf(value: string) {
  const doc = await PDFDocument.create()
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const page = doc.addPage([595, 842])
  page.drawText('BODYTEXT', { x: 60, y: 700, size: 11, font })
  const rect = { x: 49.5, y: 299.5, width: 200, height: 24 }
  const field = doc.getForm().createTextField('secret')
  field.addToPage(page, { ...rect, font, borderWidth: 0 })
  field.setText(value)
  field.updateAppearances(font)
  return { bytes: Buffer.from(await doc.save()), rect }
}

function pdfStream(content: string, dictionary = '') {
  return `<< /Length ${Buffer.byteLength(content, 'ascii')} ${dictionary} >>\nstream\n${content}\nendstream`
}

function rawPdf(objects: string[]) {
  let pdf = '%PDF-1.4\n%\xE2\xE3\xCF\xD3\n'
  const offsets: number[] = []
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(pdf, 'binary'))
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`
  })
  const xrefOffset = Buffer.byteLength(pdf, 'binary')
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const offset of offsets) {
    pdf += `${String(offset).padStart(10, '0')} 00000 n \n`
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`
  return Buffer.from(pdf, 'binary')
}

/** Minimal one-page Type1 PDF for operators pdf-lib cannot emit. */
export function rawType1Pdf(content: string) {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream(content),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
  ])
}

/**
 * A stray `Q` after a balanced `q Q`, under a `0.5` scale. pdf.js ignores the
 * extra `Q` (`CanvasGraphics.restore` early-returns on an empty stack), so the
 * page draws the text at half coordinates. A replay that pops unconditionally
 * resets the CTM to identity and places the cover at the unscaled position,
 * entirely above the 792pt page, where it paints nothing.
 */
export function rawUnbalancedRestorePdf() {
  return rawType1Pdf(
    '0.5 0 0 0.5 0 0 cm q Q Q BT /F1 12 Tf 1 0 0 1 120 1200 Tm (SECRETVALUE) Tj ET',
  )
}

/**
 * `q`/`Q` around a text-matrix change. The PDF spec keeps the text matrix out
 * of the graphics state, but pdf.js saves and restores it with everything else,
 * so text after `Q` returns to the pre-`q` baseline. A replay that restores
 * only the CTM leaves it on the matrix set between `q` and `Q`.
 */
export function rawRestoreTextMatrixPdf() {
  return rawType1Pdf(
    'BT /F1 12 Tf 1 0 0 1 60 700 Tm q 1 0 0 1 200 100 Tm Q (SECRETVALUE) Tj ET',
  )
}

export function rawFormPdf() {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /XObject << /Fm1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream('q /Fm1 Do Q'),
    pdfStream(
      'BT /F1 12 Tf 1 0 0 1 60 700 Tm (Alice) Tj ET',
      '/Type /XObject /Subtype /Form /BBox [0 0 612 792] /Matrix [1 0 0 1 100 -50] /Resources << /Font << /F1 6 0 R >> >>',
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
  ])
}

/**
 * A graphics state carrying a Font entry: the renderer applies it through
 * setFont, so the text after `/GS1 gs` is set at 24pt Times with no `Tf`
 * operator of its own. A replay that ignores the entry lays it at 12pt
 * Helvetica and paints the cover above the ink.
 */
export function rawGStateFontPdf() {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> /ExtGState << /GS1 7 0 R >> >> /Contents 4 0 R >>',
    pdfStream(
      'BT /F1 12 Tf 1 0 0 1 60 700 Tm (BODYTEXT) Tj ET ' +
        '/GS1 gs ' +
        'BT 1 0 0 1 60 600 Tm (SECRETVALUE) Tj ET',
    ),
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Roman /Encoding /WinAnsiEncoding >>',
    '<< /Type /ExtGState /Font [ /F2 24 ] >>',
  ])
}

export function rawType3Pdf(textMatrix = '1 0 0 1 60 700') {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream(`BT /F1 12 Tf ${textMatrix} Tm (AAA) Tj ET`),
    '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 100 80] /FontMatrix [0.01 0 0 0.01 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [100] /Resources << >> >>',
    pdfStream('100 0 d0 0 0 100 80 re f'),
  ])
}

/** Type 3 font reached only through an ExtGState /Font entry, no `Tf`. */
export function rawGStateType3Pdf() {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> /ExtGState << /GS1 7 0 R >> >> /Contents 4 0 R >>',
    pdfStream('/GS1 gs BT 1 0 0 1 60 700 Tm (AAA) Tj ET'),
    '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 100 80] /FontMatrix [0.01 0 0 0.01 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [100] /Resources << >> >>',
    pdfStream('100 0 d0 0 0 100 80 re f'),
    '<< /Type /ExtGState /Font [ 5 0 R 24 ] >>',
  ])
}

function toUnicodeCmap(mappings: Array<[string, string]>) {
  return `/CIDInit /ProcSet findresource begin
12 dict begin
begincmap
/CIDSystemInfo << /Registry (Adobe) /Ordering (UCS) /Supplement 0 >> def
/CMapName /Adobe-Identity-UCS def
/CMapType 2 def
1 begincodespacerange
<0000> <FFFF>
endcodespacerange
${mappings.length} beginbfchar
${mappings.map(([source, target]) => `<${source}> <${target}>`).join('\n')}
endbfchar
endcmap
CMapName currentdict /CMap defineresource pop
end
end`
}

function rawCidPdf(input: {
  codes: string
  encoding: 'Identity-H' | 'Identity-V'
  mappings: Array<[string, string]>
  descendantMetrics: string
}) {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream(`BT /F1 18 Tf 1 0 0 1 60 700 Tm <${input.codes}> Tj ET`),
    `<< /Type /Font /Subtype /Type0 /BaseFont /Test /Encoding /${input.encoding} /DescendantFonts [6 0 R] /ToUnicode 8 0 R >>`,
    `<< /Type /Font /Subtype /CIDFontType2 /BaseFont /Test /CIDSystemInfo << /Registry (Adobe) /Ordering (Identity) /Supplement 0 >> /FontDescriptor 7 0 R ${input.descendantMetrics} /CIDToGIDMap /Identity >>`,
    '<< /Type /FontDescriptor /FontName /Test /Flags 32 /FontBBox [0 -200 1000 900] /ItalicAngle 0 /Ascent 800 /Descent -200 /CapHeight 700 /StemV 80 >>',
    pdfStream(toUnicodeCmap(input.mappings)),
  ])
}

export function rawRtlPdf() {
  return rawCidPdf({
    codes: '0001000200030004',
    encoding: 'Identity-H',
    mappings: [
      ['0001', '05DD'],
      ['0002', '05D5'],
      ['0003', '05DC'],
      ['0004', '05E9'],
    ],
    descendantMetrics: '/DW 600',
  })
}

export function rawVerticalPdf() {
  return rawCidPdf({
    codes: '000100020003',
    encoding: 'Identity-V',
    mappings: [
      ['0001', '0041'],
      ['0002', '0042'],
      ['0003', '0043'],
    ],
    descendantMetrics:
      '/DW 1000 /DW2 [880 -1000] /W2 [1 [ -1000 500 880 -1000 500 880 -1000 500 880 ]]',
  })
}
