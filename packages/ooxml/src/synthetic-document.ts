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

/**
 * Builds a minimal, valid DOCX whose document body is one paragraph per text,
 * deliberately without any `w14:paraId`. Tests that exercise the first-save
 * transition for a legacy document need real bytes with positional identities,
 * not a hand-built model whose ids never shift.
 */
export async function createSyntheticDocx(
  paragraphs: readonly string[],
): Promise<Uint8Array> {
  const body = paragraphs
    .map(
      (text) =>
        `<w:p><w:r><w:t xml:space="preserve">${escapeXmlText(text)}</w:t></w:r></w:p>`,
    )
    .join('')
  const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="${WORD_NAMESPACE}"><w:body>${body}<w:sectPr/></w:body></w:document>`
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
