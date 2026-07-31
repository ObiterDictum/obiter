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

export function rawType3Pdf() {
  return rawPdf([
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>',
    pdfStream('BT /F1 12 Tf 1 0 0 1 60 700 Tm (AAA) Tj ET'),
    '<< /Type /Font /Subtype /Type3 /FontBBox [0 0 100 80] /FontMatrix [0.01 0 0 0.01 0 0] /CharProcs << /A 6 0 R >> /Encoding << /Type /Encoding /Differences [65 /A] >> /FirstChar 65 /LastChar 65 /Widths [100] /Resources << >> >>',
    pdfStream('100 0 d0 0 0 100 80 re f'),
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
