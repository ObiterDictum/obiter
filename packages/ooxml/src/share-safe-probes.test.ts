import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildShareSafeDocx, parseDocx, ShareSafeRefusal } from './index'

const W = 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'
const R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
const PKG_R = 'http://schemas.openxmlformats.org/package/2006/relationships'
const CT = 'http://schemas.openxmlformats.org/package/2006/content-types'
const STRICT_W = 'http://purl.oclc.org/ooxml/wordprocessingml/main'

interface ProbeSpec {
  body?: string
  document?: string
  documentRels?: string
  rootRels?: string
  parts?: Record<string, string>
  overrides?: string
}

function rel(id: string, tail: string, target: string, extra = '') {
  return `<Relationship Id="${id}" Type="${R}/${tail}" Target="${target}"${extra}/>`
}

function override(partName: string, tail: string) {
  return `<Override PartName="${partName}" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.${tail}+xml"/>`
}

async function probePackage(spec: ProbeSpec): Promise<Uint8Array> {
  const zip = new JSZip()
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0"?><Types xmlns="${CT}"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>${spec.overrides ?? ''}</Types>`,
  )
  zip.file(
    '_rels/.rels',
    `<Relationships xmlns="${PKG_R}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/>${spec.rootRels ?? ''}</Relationships>`,
  )
  zip.file(
    'word/document.xml',
    spec.document ??
      `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:r="${R}"><w:body><w:p><w:r><w:t>Visible.</w:t></w:r></w:p>${spec.body ?? ''}</w:body></w:document>`,
  )
  zip.file(
    'word/_rels/document.xml.rels',
    `<Relationships xmlns="${PKG_R}">${spec.documentRels ?? ''}</Relationships>`,
  )
  for (const [name, source] of Object.entries(spec.parts ?? {})) {
    zip.file(name, source)
  }
  return zip.generateAsync({ type: 'uint8array' })
}

async function probeOutput(spec: ProbeSpec) {
  const document = await parseDocx(await probePackage(spec))
  const bytes = await buildShareSafeDocx(document)
  const zip = await JSZip.loadAsync(bytes)
  const parts = new Map<string, string>()
  for (const [name, file] of Object.entries(zip.files)) {
    if (!file.dir) parts.set(name, await file.async('string'))
  }
  return parts
}

async function probeRefusal(spec: ProbeSpec) {
  const document = await parseDocx(await probePackage(spec))
  await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
    ShareSafeRefusal,
  )
}

function settingsSpec(settingsChildren: string): ProbeSpec {
  return {
    documentRels: rel('rId9', 'settings', 'settings.xml'),
    overrides: override('/word/settings.xml', 'settings'),
    parts: {
      'word/settings.xml': `<?xml version="1.0"?><w:settings xmlns:w="${W}" xmlns:r="${R}" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml">${settingsChildren}</w:settings>`,
    },
  }
}

describe('share-safe probes: revision and permission markup', () => {
  it.each([
    'numberingChange',
    'tblPrExChange',
    'cellIns',
    'cellDel',
    'cellMerge',
    'delInstrText',
    'moveFromRangeStart',
    'moveToRangeEnd',
    'customXmlInsRangeStart',
    'customXmlDelRangeStart',
    'customXmlMoveFromRangeEnd',
    'customXmlMoveToRangeStart',
    'permStart',
    'permEnd',
  ])('refuses w:%s', async (name) => {
    await probeRefusal({
      body: `<w:p><w:pPr><w:${name} w:id="1" w:author="SECRETAUTHOR"/></w:pPr></w:p>`,
    })
  })

  it('refuses revision markup in the numbering part', async () => {
    await probeRefusal({
      documentRels: rel('rId9', 'numbering', 'numbering.xml'),
      overrides: override('/word/numbering.xml', 'numbering'),
      parts: {
        'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="${W}"><w:num w:numId="1"><w:numberingChange w:id="7" w:author="SECRETAUTHOR" w:original="1"/><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
      },
    })
  })

  it('refuses an unknown element carrying revision identity attributes', async () => {
    await probeRefusal({
      body: `<w:p><w:futureMarkup w:author="SECRETAUTHOR"/></w:p>`,
    })
  })

  it('refuses strict-namespace package markup', async () => {
    await probeRefusal({
      document: `<?xml version="1.0"?><w:document xmlns:w="${STRICT_W}"><w:body><w:p><w:del w:author="SECRETAUTHOR"><w:r><w:delText>SECRETDELETED</w:delText></w:r></w:del></w:p></w:body></w:document>`,
    })
  })

  it('refuses a foreign-namespace payload inside a transitional part', async () => {
    await probeRefusal({
      body: `<w:p><x:payload xmlns:x="urn:probe-payload"><x:entry>SECRET</x:entry></x:payload></w:p>`,
    })
  })
})

describe('share-safe probes: field instructions', () => {
  it.each([
    'INCLUDETEXT',
    'INCLUDEPICTURE',
    'LINK',
    'DDE',
    'DDEAUTO',
    'IMPORT',
    'HYPERLINK',
    'DATABASE',
    'RD',
    'EMBED',
    'PRIVATE',
    'DOCPROPERTY',
    'DOCVARIABLE',
    'MERGEFIELD',
    'AUTOTEXT',
    'NEXT',
    'SKIPIF',
    'FILLIN',
    'MACROBUTTON',
    'PRINT',
    'BIBLIOGRAPHY',
    'CITATION',
    'UNKNOWNFIELDNAME',
  ])('refuses %s instructions', async (name) => {
    await probeRefusal({
      body: `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> ${name} "x" </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    })
  })

  it('refuses a field hidden in CDATA', async () => {
    await probeRefusal({
      body: `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText><![CDATA[ INCLUDETEXT \\\\server\\leak.docx ]]></w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    })
  })

  it('refuses a field split by an XML comment', async () => {
    await probeRefusal({
      body: `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> INCLUDE<!-- decoy -->TEXT "x" </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    })
  })

  it('refuses a field instruction under a different prefix bound to w', async () => {
    await probeRefusal({
      document: `<?xml version="1.0"?><wx:document xmlns:wx="${W}"><wx:body><wx:p><wx:r><wx:fldChar wx:fldCharType="begin"/><wx:instrText> INCLUDETEXT "x" </wx:instrText><wx:fldChar wx:fldCharType="end"/></wx:r></wx:p></wx:body></wx:document>`,
    })
  })

  it('refuses opaque field payloads', async () => {
    await probeRefusal({
      body: `<w:p><w:r><w:fldChar w:fldCharType="begin"><w:fldData>SECRETB64</w:fldData></w:fldChar><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
    })
  })

  it.each(['TOC \\o "1-3"', 'PAGE', 'PAGEREF note', 'REF note', 'SEQ figure'])(
    'keeps the allowed %s field',
    async (instruction) => {
      const parts = await probeOutput({
        body: `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> ${instruction} </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
      })
      expect(parts.get('word/document.xml')).toContain('instrText')
    },
  )
})

describe('share-safe probes: hidden content', () => {
  it('refuses a hidden table row', async () => {
    await probeRefusal({
      body: `<w:tbl><w:tr><w:trPr><w:hidden/></w:trPr><w:tc><w:p><w:r><w:t>SECRETHIDDEN</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    })
  })

  it('refuses hidden text through conditional table formatting', async () => {
    await probeRefusal({
      body: `<w:tbl><w:tblPr><w:tblStylePr w:type="firstRow"><w:rPr><w:vanish/></w:rPr></w:tblStylePr></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>SECRETHIDDEN</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`,
    })
  })

  it('refuses hidden text through sdt character properties', async () => {
    await probeRefusal({
      body: `<w:sdt><w:sdtPr><w:rPr><w:vanish/></w:rPr></w:sdtPr><w:sdtContent><w:r><w:t>SECRETHIDDEN</w:t></w:r></w:sdtContent></w:sdt>`,
    })
  })

  it('refuses hidden text through an inherited style', async () => {
    await probeRefusal({
      documentRels: rel('rId9', 'styles', 'styles.xml'),
      overrides: override('/word/styles.xml', 'styles'),
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"><w:style w:type="paragraph" w:styleId="Secret"><w:name w:val="Secret"/><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`,
      },
      body: `<w:p><w:pPr><w:pStyle w:val="Secret"/></w:pPr><w:r><w:t>SECRETHIDDEN</w:t></w:r></w:p>`,
    })
  })

  it('refuses a hidden drawing object', async () => {
    await probeRefusal({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="x" hidden="1"/></wp:inline></w:drawing></w:r></w:p>`,
    })
  })

  it('refuses VML, including hidden VML', async () => {
    await probeRefusal({
      body: `<w:p><w:r><w:pict><v:shape xmlns:v="urn:schemas-microsoft-com:vml" id="x" style="display:none"><v:fill src="SECRET"/></v:shape></w:pict></w:r></w:p>`,
    })
  })

  it.each(['w:vanish', 'w:webHidden', 'w:specVanish'])(
    'refuses %s on runs',
    async (name) => {
      await probeRefusal({
        body: `<w:p><w:r><w:rPr><${name}/></w:rPr><w:t>SECRETHIDDEN</w:t></w:r></w:p>`,
      })
    },
  )

  it('keeps run properties that explicitly switch hiding off', async () => {
    const parts = await probeOutput({
      body: `<w:p><w:r><w:rPr><w:vanish w:val="0"/><w:webHidden w:val="false"/></w:rPr><w:t>Visible.</w:t></w:r></w:p>`,
    })
    expect(parts.get('word/document.xml')).toContain('Visible.')
  })

  it('keeps a vanished paragraph mark', async () => {
    const parts = await probeOutput({
      body: `<w:p><w:pPr><w:rPr><w:vanish/></w:rPr></w:pPr><w:r><w:t>Visible.</w:t></w:r></w:p>`,
    })
    expect(parts.get('word/document.xml')).toContain('Visible.')
  })
})

describe('share-safe probes: pointer attributes and opaque payloads', () => {
  it.each([
    '<w:object o:progId="Word.Document" xmlns:o="urn:schemas-microsoft-com:office:office"/>',
    '<w:control r:id="rId9"/>',
    '<w:altChunk r:id="rId9"/>',
    '<w:subDoc r:id="rId9"/>',
    '<w:pict><w:binData w:name="x">SECRETPAYLOAD</w:binData></w:pict>',
  ])('refuses %s', async (fragment) => {
    await probeRefusal({ body: `<w:p><w:r>${fragment}</w:r></w:p>` })
  })

  it('refuses an undeclared relationship pointer', async () => {
    await probeRefusal({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId40"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    })
  })

  it('strips office-namespace pointer attributes on kept elements', async () => {
    const parts = await probeOutput({
      body: `<w:p o:relid="rId40" xmlns:o="urn:schemas-microsoft-com:office:office"><w:r><w:t>Visible.</w:t></w:r></w:p>`,
    })
    const story = parts.get('word/document.xml')
    expect(story).not.toContain('o:relid')
    expect(story).toContain('Visible.')
  })

  it('refuses a drawing hyperlink relationship it cannot detach', async () => {
    await probeRefusal({
      documentRels: rel(
        'rId9',
        'hyperlink',
        'https://example.invalid/SECRET',
        ' TargetMode="External"',
      ),
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="x"><a:hlinkClick xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" r:id="rId9"/></wp:docPr></wp:inline></w:drawing></w:r></w:p>`,
    })
  })

  it('refuses webSettings frameset pointers', async () => {
    await probeRefusal({
      documentRels: rel('rId9', 'webSettings', 'webSettings.xml'),
      overrides: override('/word/webSettings.xml', 'webSettings'),
      parts: {
        'word/webSettings.xml': `<?xml version="1.0"?><w:webSettings xmlns:w="${W}"><w:frameset><w:frame w:name="x"/><w:srcFile r:id="rId20"/></w:frameset></w:webSettings>`,
      },
    })
  })
})

describe('share-safe probes: settings and provenance', () => {
  it.each([
    '<w:writeReservation w:name="SECRETNAME" w:datetime="2024-01-01T00:00:00Z"/>',
    '<w:documentProtection w:hashValue="SECRETHASH" w:saltValue="SECRETSALT"/>',
    '<w:schemaLibrary xmlns:sl="http://schemas.openxmlformats.org/schemaLibrary/2006/main"><sl:schema sl:uri="SECRETSCHEMA"/></w:schemaLibrary>',
    '<w:docVars><w:docVar w:name="SECRETVAR" w:val="SECRETVAL"/></w:docVars>',
    '<w:attachedSchema w:val="SECRETSCHEMA"/>',
    '<w:smartTagType w:namespaceuri="SECRETURI" w:name="x"/>',
    '<w:saveThroughXslt w:xslt="SECRETPATH"/>',
    '<w:mailMerge w:mainDocumentType="formLetters"/>',
    '<w:savePreviewPicture/>',
    '<w:trackRevisions/>',
    '<w:attachedTemplate r:id="rId20"/>',
    '<w14:docId w14:val="SECRETID"/>',
  ])('removes settings residue %s', async (fragment) => {
    const parts = await probeOutput(settingsSpec(fragment))
    const settings = parts.get('word/settings.xml')
    if (settings === undefined) throw new Error('settings part missing')
    expect(settings).not.toContain('SECRET')
    expect(settings).not.toContain(fragment.slice(0, fragment.indexOf(' ')))
  })

  it('keeps ordinary settings flags', async () => {
    const parts = await probeOutput(
      settingsSpec('<w:zoom w:percent="100"/><w:evenAndOddHeaders/>'),
    )
    expect(parts.get('word/settings.xml')).toContain('w:zoom')
  })
})

describe('share-safe probes: canonical metadata output', () => {
  const rootParts = {
    'docProps/core.xml': `<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:x="urn:probe-foreign" x:secret="SECRETATTR"><dc:creator xmlns:dc="http://purl.org/dc/elements/1.1/">SECRETNAME</dc:creator></cp:coreProperties>`,
    'docProps/app.xml': `<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:x="urn:probe-foreign" x:secret="SECRETATTR"><Application>SECRETAPP</Application></Properties>`,
  }
  const rootRels =
    `<Relationship Id="rId8" Type="${PKG_R}/metadata/core-properties" Target="docProps/core.xml"/>` +
    `<Relationship Id="rId9" Type="${R}/extended-properties" Target="docProps/app.xml"/>`
  const overrides =
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>'

  it('emits a canonical core properties root', async () => {
    const parts = await probeOutput({ parts: rootParts, rootRels, overrides })
    const core = parts.get('docProps/core.xml')
    if (core === undefined) throw new Error('core part missing')
    expect(core).not.toContain('SECRET')
    expect(core).not.toContain('urn:probe-foreign')
    expect(core).toContain('<cp:coreProperties')
    expect(core.match(/<dc:/gu)).toBeNull()
  })

  it('emits a canonical app properties root', async () => {
    const parts = await probeOutput({ parts: rootParts, rootRels, overrides })
    const app = parts.get('docProps/app.xml')
    if (app === undefined) throw new Error('app part missing')
    expect(app).not.toContain('SECRET')
    expect(app).not.toContain('urn:probe-foreign')
  })
})

describe('share-safe probes: provenance and binding surfaces', () => {
  it.each([
    [
      'sdt tag',
      '<w:sdt><w:sdtPr><w:tag w:val="SECRETTAG"/><w:alias w:val="kept"/></w:sdtPr><w:sdtContent><w:r><w:t>Visible.</w:t></w:r></w:sdtContent></w:sdt>',
      'SECRETTAG',
    ],
    [
      'sdt dataBinding',
      '<w:sdt><w:sdtPr><w:dataBinding w:xpath="SECRETXPATH" w:storeItemID="{SECRETGUID}"/></w:sdtPr><w:sdtContent><w:r><w:t>Visible.</w:t></w:r></w:sdtContent></w:sdt>',
      'SECRETXPATH',
    ],
    [
      'sdt glossary pointer',
      '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="SECRETGALLERY"/></w:docPartObj></w:sdtPr><w:sdtContent><w:r><w:t>Visible.</w:t></w:r></w:sdtContent></w:sdt>',
      'SECRETGALLERY',
    ],
    [
      'sdt identity',
      '<w:sdt><w:sdtPr><w:id w:val="SECRETID"/></w:sdtPr><w:sdtContent><w:r><w:t>Visible.</w:t></w:r></w:sdtContent></w:sdt>',
      'SECRETID',
    ],
    [
      'smart tag',
      '<w:smartTag w:uri="SECRETURI" w:element="x"><w:r><w:t>Visible.</w:t></w:r></w:smartTag>',
      'SECRETURI',
    ],
    [
      'customXml binding',
      '<w:customXml w:uri="SECRETURI" w:element="x" w:item="{SECRETGUID}"><w:r><w:t>Visible.</w:t></w:r></w:customXml>',
      'SECRETURI',
    ],
    [
      'displaced attribute',
      '<w:p w:displacedByCustomXml="prev"><w:r><w:t>Visible.</w:t></w:r></w:p>',
      'displacedByCustomXml',
    ],
    [
      'foreign attribute',
      '<w:p xmlns:x="urn:probe-foreign" x:marker="SECRETMARK"><w:r><w:t>Visible.</w:t></w:r></w:p>',
      'SECRETMARK',
    ],
    [
      'word extension id',
      '<w:p w14:paraId="SECRETPARAID" w14:textId="SECRETTEXTID" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"><w:r><w:t>Visible.</w:t></w:r></w:p>',
      'SECRETPARAID',
    ],
    [
      'drawing object metadata',
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><wp:docPr id="1" name="SECRETNAME" descr="SECRETDESCR" title="SECRETTITLE"/></wp:inline></w:drawing></w:r></w:p>',
      'SECRETNAME',
    ],
  ])(
    'strips %s while keeping visible content',
    async (_label, body, needle) => {
      const parts = await probeOutput({ body })
      const story = parts.get('word/document.xml')
      if (story === undefined) throw new Error('document part missing')
      expect(story).not.toContain(needle)
      expect(story).toContain('Visible.')
    },
  )

  it('strips foreign attributes on relationship parts', async () => {
    const parts = await probeOutput({
      documentRels: `<Relationship Id="rId9" Type="${R}/styles" Target="styles.xml" xmlns:x="urn:probe-foreign" x:marker="SECRETMARK"/>`,
      overrides: override('/word/styles.xml', 'styles'),
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
      },
    })
    const rels = parts.get('word/_rels/document.xml.rels')
    expect(rels).not.toContain('SECRETMARK')
  })

  it('drops a declared customXml store: part, properties and rels go', async () => {
    const parts = await probeOutput({
      documentRels: rel('rId9', 'customXml', '../customXml/item1.xml'),
      parts: {
        'customXml/item1.xml': `<?xml version="1.0"?><store>SECRETSTORE</store>`,
        'customXml/itemProps1.xml': `<?xml version="1.0"?><ds:datastoreItem xmlns:ds="http://schemas.openxmlformats.org/officeDocument/2006/customXml"/>`,
      },
    })
    // A declared store is dead payload — every Word save carries a
    // bibliography customXml — so part, properties and rels go while the
    // document's bound markup is stripped at element level.
    expect(parts.has('customXml/item1.xml')).toBe(false)
    expect(parts.has('customXml/itemProps1.xml')).toBe(false)
    expect(parts.get('word/_rels/document.xml.rels') ?? '').not.toContain(
      'customXml',
    )
    expect(parts.get('word/document.xml')).toContain('Visible.')
  })

  it('refuses a foreign element inside content-types', async () => {
    const zip = new JSZip()
    zip.file(
      '[Content_Types].xml',
      `<?xml version="1.0"?><Types xmlns="${CT}" xmlns:x="urn:probe-foreign"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><x:payload>SECRET</x:payload></Types>`,
    )
    zip.file(
      '_rels/.rels',
      `<Relationships xmlns="${PKG_R}"><Relationship Id="rId1" Type="${R}/officeDocument" Target="word/document.xml"/></Relationships>`,
    )
    zip.file(
      'word/document.xml',
      `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Visible.</w:t></w:r></w:p></w:body></w:document>`,
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })
})
