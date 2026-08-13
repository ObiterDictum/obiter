import JSZip from 'jszip'

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

const DOCUMENT_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">
  <w:body>
    <w:p w14:paraId="00000001" w14:textId="00000001">
      <w:r>
        <w:t xml:space="preserve"></w:t>
      </w:r>
    </w:p>
    <w:sectPr/>
  </w:body>
</w:document>`

const DOCUMENT_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"/>`

export async function createBlankDocx() {
  const zip = new JSZip()
  zip.file('[Content_Types].xml', CONTENT_TYPES_XML, { date: FIXED_DATE })
  zip.file('_rels/.rels', ROOT_RELS_XML, { date: FIXED_DATE })
  zip.file('word/document.xml', DOCUMENT_XML, { date: FIXED_DATE })
  zip.file('word/_rels/document.xml.rels', DOCUMENT_RELS_XML, {
    date: FIXED_DATE,
  })
  return zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    platform: 'DOS',
  })
}
