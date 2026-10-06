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

const RELATIONSHIPS_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

const HEADER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml'
const FOOTER_CONTENT_TYPE =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml'

const WORD_NAMESPACE =
  'http://schemas.openxmlformats.org/wordprocessingml/2006/main'

const WORD_2010_NAMESPACE =
  'http://schemas.microsoft.com/office/word/2010/wordml'

const DOCUMENT_R_NAMESPACE =
  ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'

export type SyntheticParagraph =
  | string
  | { text: string; paraId?: string }
  | { table: { rows: number; columns: number } }

/**
 * An optional header or footer the body's single section references. Each is
 * one paragraph of text in its own part, so tests can put a margin story
 * through the same parse–edit–serialise pipeline as a real document.
 */
export type SyntheticMargins = {
  header?: string
  footer?: string
}

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
  margins: SyntheticMargins = {},
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
  const references = [
    margins.header === undefined
      ? ''
      : '<w:headerReference w:type="default" r:id="rIdHeader"/>',
    margins.footer === undefined
      ? ''
      : '<w:footerReference w:type="default" r:id="rIdFooter"/>',
  ].join('')
  const section =
    references.length === 0
      ? '<w:sectPr/>'
      : `<w:sectPr>${references}</w:sectPr>`
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"${namespace}${references.length === 0 ? '' : DOCUMENT_R_NAMESPACE}><w:body>${body}${section}</w:body></w:document>`
  const zip = new JSZip()
  zip.file('[Content_Types].xml', contentTypesXml(margins), {
    date: FIXED_DATE,
  })
  zip.file('_rels/.rels', ROOT_RELS_XML, { date: FIXED_DATE })
  zip.file('word/document.xml', documentXml, { date: FIXED_DATE })
  zip.file('word/_rels/document.xml.rels', documentRelsXml(margins), {
    date: FIXED_DATE,
  })
  if (margins.header !== undefined) {
    zip.file('word/header1.xml', marginXml('hdr', margins.header), {
      date: FIXED_DATE,
    })
  }
  if (margins.footer !== undefined) {
    zip.file('word/footer1.xml', marginXml('ftr', margins.footer), {
      date: FIXED_DATE,
    })
  }
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}

function contentTypesXml(margins: SyntheticMargins) {
  const overrides = [
    margins.header === undefined
      ? ''
      : `  <Override PartName="/word/header1.xml" ContentType="${HEADER_CONTENT_TYPE}"/>`,
    margins.footer === undefined
      ? ''
      : `  <Override PartName="/word/footer1.xml" ContentType="${FOOTER_CONTENT_TYPE}"/>`,
  ]
  return `${CONTENT_TYPES_XML.slice(
    0,
    CONTENT_TYPES_XML.indexOf('</Types>'),
  )}${overrides.filter(Boolean).join('\n')}\n</Types>`
}

function documentRelsXml(margins: SyntheticMargins) {
  const entries = [
    margins.header === undefined
      ? ''
      : `  <Relationship Id="rIdHeader" Type="${RELATIONSHIPS_NS}/header" Target="header1.xml"/>`,
    margins.footer === undefined
      ? ''
      : `  <Relationship Id="rIdFooter" Type="${RELATIONSHIPS_NS}/footer" Target="footer1.xml"/>`,
  ]
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${entries.filter(Boolean).join('\n')}
</Relationships>`
}

function marginXml(root: 'hdr' | 'ftr', text: string) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:${root} xmlns:w="${WORD_NAMESPACE}"><w:p><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p></w:${root}>`
}
