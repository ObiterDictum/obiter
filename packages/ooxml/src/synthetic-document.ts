import JSZip from 'jszip'

import { escapeXmlText } from './parts/overlay'

const FIXED_DATE = new Date('2026-08-10T00:00:00.000Z')

const CONTENT_TYPES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`

const ROOT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'

export type SyntheticParagraph =
  | string
  | { text: string; paraId?: string }
  | { table: { rows: number; columns: number } }

/**
 * Builds a minimal, valid DOCX whose document body is one paragraph per entry,
 * with an optional `w14:paraId` on each, or a table whose cells hold one
 * unparaId'd paragraph apiece — the shape a legacy document carries. Tests
 * that exercise the first-save transition for a legacy document need real
 * bytes with positional identities, and identity tests need to control the
 * ids exactly.
 */
export async function createSyntheticDocx(
  paragraphs: readonly SyntheticParagraph[],
): Promise<Uint8Array> {
  const declaresW14 = paragraphs.some(
    (entry) =>
      typeof entry !== 'string' &&
      'paraId' in entry &&
      entry.paraId !== undefined,
  )
  const namespace = declaresW14 ? ` xmlns:w14="${WORD_2010_NAMESPACE}"` : ''
  const body = paragraphs
    .map((entry) => {
      if (typeof entry !== 'string' && 'table' in entry) {
        const cell = '<w:tc><w:tcPr/><w:p/></w:tc>'
        const row = `<w:tr>${cell.repeat(entry.table.columns)}</w:tr>`
        return `<w:tbl><w:tblPr/><w:tblGrid>${'<w:gridCol/>'.repeat(entry.table.columns)}</w:tblGrid>${row.repeat(entry.table.rows)}</w:tbl>`
      }
      const text = typeof entry === 'string' ? entry : entry.text
      const id =
        typeof entry === 'string' || entry.paraId === undefined
          ? ''
          : ` w14:paraId="${entry.paraId}"`
      return `<w:p${id}><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`
    })
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"${namespace}><w:body>${body}<w:sectPr/></w:body></w:document>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML, { date: FIXED_DATE })
  zip.file('_rels/.rels', ROOT_RELS_XML, { date: FIXED_DATE })
  zip.file('word/document.xml', documentXml, { date: FIXED_DATE })
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML, {
    date: FIXED_DATE,
  })
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}
