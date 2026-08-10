export const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Default Extension="png" ContentType="image/png"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>
  <Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/>
  <Override PartName="/word/endnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.endnotes+xml"/>
  <Override PartName="/word/comments.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.comments+xml"/>
  <Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/header2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
  <Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
  <Override PartName="/word/footer2.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>
</Types>`

export const rootRelationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
</Relationships>`

export const documentRelationshipsXml = `<?xml version="1.0" encoding="UTF-8"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
  <Relationship Id="rId4" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
  <Relationship Id="rId5" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header2.xml"/>
  <Relationship Id="rId6" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer2.xml"/>
  <Relationship Id="rId7" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>
  <Relationship Id="rId8" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/endnotes" Target="endnotes.xml"/>
  <Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/comments" Target="comments.xml"/>
  <Relationship Id="rId10" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/image1.png"/>
</Relationships>`

export const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture">
  <w:body>
    <w:p w14:paraId="A1B2C3D4" w14:textId="01020304"><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>Alice Example overview</w:t></w:r></w:p>
    <w:p w14:paraId="A1B2C3D5" w14:textId="01020305"><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr><w:sectPr><w:headerReference w:type="default" r:id="rId3"/><w:footerReference w:type="default" r:id="rId4"/></w:sectPr></w:pPr><w:r><w:t>Restarted list</w:t></w:r></w:p>
    <w:p><w:fldSimple w:instr=" STYLEREF Heading1 "><w:r><w:t>Overview</w:t></w:r></w:fldSimple></w:p>
    <w:p><w:fldSimple w:instr=" SEQ Figure "><w:r><w:t>1</w:t></w:r></w:fldSimple></w:p>
    <w:p><w:fldSimple w:instr=" TOC \\o &quot;1-3&quot; "><w:r><w:t>Contents</w:t></w:r></w:fldSimple></w:p>
    <w:p><w:bookmarkStart w:id="4" w:name="JaneBookmark"/><w:r><w:t>Jane Example reference</w:t></w:r><w:bookmarkEnd w:id="4"/><w:fldSimple w:instr=" REF JaneBookmark "><w:r><w:t>Jane Example reference</w:t></w:r></w:fldSimple></w:p>
    <w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val="2"/><w:vMerge w:val="restart"/></w:tcPr><w:p><w:r><w:t>Merged cell</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>Nested cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl></w:tc></w:tr><w:tr><w:tc><w:tcPr><w:vMerge/></w:tcPr><w:p/></w:tc></w:tr></w:tbl>
    <w:sdt><w:sdtPr><w:tag w:val="fixed-control"/></w:sdtPr><w:sdtContent><w:p><w:r><w:t>Controlled content</w:t></w:r></w:p></w:sdtContent></w:sdt>
    <w:p><w:r><w:drawing><wp:inline><wp:extent cx="1000" cy="1000"/><a:graphic><a:graphicData><pic:pic><pic:blipFill><a:blip r:embed="rId10"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>
    <w:p><w:commentRangeStart w:id="0"/><w:r><w:t>Commented text</w:t></w:r><w:commentRangeEnd w:id="0"/><w:r><w:commentReference w:id="0"/><w:footnoteReference w:id="1"/><w:endnoteReference w:id="1"/></w:r></w:p>
    <w:p><w:ins w:id="10" w:author="Alice Example" w:date="2026-08-10T10:00:00Z"><w:r><w:t>Inserted</w:t></w:r></w:ins><w:del w:id="11" w:author="Jane Example" w:date="2026-08-10T10:01:00Z"><w:r><w:delText>Deleted</w:delText></w:r></w:del><w:moveFrom w:id="12" w:author="Alice Example" w:date="2026-08-10T10:02:00Z"><w:r><w:t>From</w:t></w:r></w:moveFrom><w:moveTo w:id="13" w:author="Jane Example" w:date="2026-08-10T10:03:00Z"><w:r><w:t>To</w:t></w:r></w:moveTo></w:p>
    <w:p><w:pPr><w:pPrChange w:id="14" w:author="Alice Example" w:date="2026-08-10T10:04:00Z"><w:pPr><w:jc w:val="center"/></w:pPr></w:pPrChange></w:pPr><w:r><w:rPr><w:rPrChange w:id="15" w:author="Jane Example" w:date="2026-08-10T10:05:00Z"><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t>Tracked formatting</w:t></w:r></w:p>
    <w:sectPr><w:headerReference w:type="default" r:id="rId5"/><w:footerReference w:type="default" r:id="rId6"/></w:sectPr>
  </w:body>
</w:document>`

export const stylesXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:style w:type="paragraph" w:styleId="Base"><w:name w:val="Base"/></w:style><w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Base"/><w:link w:val="Heading1Char"/></w:style><w:style w:type="character" w:styleId="Heading1Char"><w:link w:val="Heading1"/></w:style></w:styles>`

export const numberingXml = `<?xml version="1.0" encoding="UTF-8"?>
<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num></w:numbering>`

export function storyXml(root: string, text: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><w:${root} xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:${root}>`
}

export const footnotesXml = `<?xml version="1.0" encoding="UTF-8"?><w:footnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:footnote w:id="-1"><w:p/></w:footnote><w:footnote w:id="1"><w:p><w:r><w:t>Alice Example footnote</w:t></w:r></w:p></w:footnote></w:footnotes>`
export const endnotesXml = `<?xml version="1.0" encoding="UTF-8"?><w:endnotes xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:endnote w:id="-1"><w:p/></w:endnote><w:endnote w:id="1"><w:p><w:r><w:t>Jane Example endnote</w:t></w:r></w:p></w:endnote></w:endnotes>`
export const commentsXml = `<?xml version="1.0" encoding="UTF-8"?><w:comments xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:comment w:id="0" w:author="Alice Example" w:date="2026-08-10T09:00:00Z"><w:p><w:r><w:t>Fictional review comment</w:t></w:r></w:p></w:comment></w:comments>`

export function relationshipsXml(id: string, type: string, target: string) {
  return `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"/></Relationships>`
}

export const opaqueXmlParts = {
  'docProps/core.xml': `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><cp:creator>Alice Example</cp:creator></cp:coreProperties>`,
  'word/settings.xml': `<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/></w:settings>`,
  'word/theme/theme1.xml': `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Fixed Theme"/>`,
  'word/fontTable.xml': `<?xml version="1.0"?><w:fonts xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:font w:name="Arial"/></w:fonts>`,
  'word/webSettings.xml': `<?xml version="1.0"?><w:webSettings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"/>`,
  'docProps/custom.xml': `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/custom-properties"/>`,
  'customXml/item1.xml': `<?xml version="1.0"?><fixture xmlns="urn:obiter:synthetic">fixed</fixture>`,
  '_xmlsignatures/sig1.xml': `<?xml version="1.0"?><Signature xmlns="http://www.w3.org/2000/09/xmldsig#"><Object>synthetic</Object></Signature>`,
} as const

export const fixedPngBytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0,
  0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 8, 215,
  99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73,
  69, 78, 68, 174, 66, 96, 130,
])
