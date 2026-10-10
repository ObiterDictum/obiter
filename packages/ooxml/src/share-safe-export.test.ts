import JSZip from 'jszip'
import { describe, expect, it } from 'bun:test'

import { buildOoxmlFixture } from '../fixtures/builder'
import { buildShareSafeDocx, parseDocx, ShareSafeRefusal } from './index'

async function zipParts(bytes: Uint8Array) {
  const zip = await JSZip.loadAsync(bytes)
  const parts = new Map<string, string>()
  for (const [name, file] of Object.entries(zip.files)) {
    if (file.dir) continue
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      parts.set(name, await file.async('string'))
    }
  }
  return parts
}

async function partSource(bytes: Uint8Array, name: string) {
  const zip = await JSZip.loadAsync(bytes)
  const file = zip.file(name)
  if (!file) throw new Error(`Fixture part ${name} is missing.`)
  return file.async('string')
}

/**
 * The shared fixture carries real tracked changes, which the policy refuses.
 * This variant drops the tracked-change markup — but keeps `w:trackRevisions`
 * in settings — so the removal half of the policy is exercised end to end.
 */
async function withoutTrackedChanges() {
  const zip = await JSZip.loadAsync(
    await buildOoxmlFixture('full-fidelity-with-w14-ids'),
  )
  const document = zip.file('word/document.xml')
  if (!document) throw new Error('Fixture part is missing.')
  const source = (await document.async('string'))
    .replace(/<w:p><w:ins[\s\S]*?<\/w:p>/u, '')
    .replace(/<w:p><w:pPr><w:pPrChange[\s\S]*?<\/w:p>/u, '')
  zip.file('word/document.xml', source)
  return zip.generateAsync({ type: 'uint8array' })
}

async function fixtureZip() {
  return JSZip.loadAsync(await withoutTrackedChanges())
}

async function zipBytes(zip: JSZip) {
  return zip.generateAsync({ type: 'uint8array' })
}

const DOCUMENT_RELS = 'word/_rels/document.xml.rels'
const REL_NS = 'http://schemas.openxmlformats.org/package/2006/relationships'

async function addDocumentRelationship(zip: JSZip, relationship: string) {
  const file = zip.file(DOCUMENT_RELS)
  if (!file) throw new Error('Fixture rels part is missing.')
  const source = (await file.async('string')).replace(
    '</Relationships>',
    `${relationship}</Relationships>`,
  )
  zip.file(DOCUMENT_RELS, source)
}

async function declarePart(
  zip: JSZip,
  relationshipTypeTail: string,
  target: string,
) {
  await addDocumentRelationship(
    zip,
    `<Relationship Id="rId80" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${relationshipTypeTail}" Target="${target}"/>`,
  )
}

describe('share-safe export', () => {
  it('refuses a document that still carries tracked changes', async () => {
    const document = await parseDocx(
      await buildOoxmlFixture('full-fidelity-with-w14-ids'),
    )
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
    await expect(buildShareSafeDocx(document)).rejects.toThrow(
      'tracked changes',
    )
  })

  it('strips comments, markers, authorship metadata and signatures', async () => {
    const zip = await fixtureZip()
    // The fixture leaves settings.xml undeclared; a real package declares it,
    // and a declared settings part must survive with its tracking flag gone.
    await declarePart(zip, 'settings', 'settings.xml')
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)

    // Comment parts and every dangling pointer into them are gone.
    expect(parts.has('word/comments.xml')).toBe(false)
    expect(parts.has('word/_rels/comments.xml.rels')).toBe(false)
    expect(parts.get('word/_rels/document.xml.rels')).not.toContain(
      'relationships/comments',
    )
    expect(parts.get('[Content_Types].xml')).not.toContain('comments.xml')
    const story = parts.get('word/document.xml')
    if (story === undefined) throw new Error('document.xml missing')
    expect(story).not.toContain('commentRangeStart')
    expect(story).not.toContain('commentRangeEnd')
    expect(story).not.toContain('commentReference')
    // The commented run's text, and the footnote/endnote references sharing
    // its sibling run, are content and survive.
    expect(story).toContain('Commented text')
    expect(story).toContain('footnoteReference')
    expect(story).toContain('endnoteReference')

    // Authorship and descriptive metadata leave as a bare properties root —
    // children go whole, so nothing rides in a foreign element's attributes.
    expect(parts.get('docProps/core.xml')).toContain(
      '<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"></cp:coreProperties>',
    )
    expect(parts.get('docProps/core.xml')).not.toContain('Alice Example')
    // The signature over the original bytes is void and dropped.
    expect(parts.has('_xmlsignatures/sig1.xml')).toBe(false)
    // Track-changes-on is not inherited by the recipient.
    expect(parts.get('word/settings.xml')).not.toContain('trackRevisions')
    // Unreferenced parts ride along in the source but never reach the copy.
    expect(parts.has('customXml/item1.xml')).toBe(false)
    // Visible content is untouched.
    expect(story).toContain('Alice Example overview')
  })

  it('keeps the product markings while dropping foreign custom properties', async () => {
    const zip = await JSZip.loadAsync(await withoutTrackedChanges())
    const custom = await zip.file('docProps/custom.xml')?.async('string')
    if (custom === undefined) throw new Error('Fixture part is missing.')
    zip.file(
      'docProps/custom.xml',
      custom.replace(
        '/>',
        '><property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="2" name="obiter.privileged"><vt:bool xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">true</vt:bool></property>' +
          '<property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="3" name="dms.matterRef"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">DMS-44</vt:lpwstr></property></Properties>',
      ),
    )
    const document = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    const bytes = await buildShareSafeDocx(document)
    const out = await partSource(bytes, 'docProps/custom.xml')
    expect(out).toContain('obiter.privileged')
    expect(out).not.toContain('dms.matterRef')
  })

  it('refuses hidden text rather than guessing at it', async () => {
    const zip = await JSZip.loadAsync(await withoutTrackedChanges())
    const document = zip.file('word/document.xml')
    if (!document) throw new Error('Fixture part is missing.')
    zip.file(
      'word/document.xml',
      (await document.async('string')).replace(
        '<w:r><w:t>Restarted list</w:t></w:r>',
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>Secret</w:t></w:r><w:r><w:t>Restarted list</w:t></w:r>',
      ),
    )
    const parsed = await parseDocx(
      await zip.generateAsync({ type: 'uint8array' }),
    )
    await expect(buildShareSafeDocx(parsed)).rejects.toThrow('hidden content')
  })

  it('refuses a declared embedded package it cannot inspect', async () => {
    const zip = await fixtureZip()
    zip.file('word/embeddings/oleObject1.bin', new Uint8Array([1, 2, 3]))
    await declarePart(zip, 'oleObject', 'embeddings/oleObject1.bin')
    const parsed = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(parsed)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('drops an unreferenced embedded payload rather than shipping it', async () => {
    const zip = await fixtureZip()
    zip.file('word/embeddings/oleObject1.bin', new Uint8Array([1, 2, 3]))
    const parsed = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(parsed)
    const out = await JSZip.loadAsync(bytes)
    expect(out.file('word/embeddings/oleObject1.bin')).toBeNull()
    expect(out.file('word/media/image1.png')).not.toBeNull()
  })

  it('produces a package that itself re-parses as share-safe', async () => {
    const document = await parseDocx(await withoutTrackedChanges())
    const bytes = await buildShareSafeDocx(document)
    const reparsed = await parseDocx(bytes)
    expect(reparsed.model.comments).toHaveLength(0)
    expect(reparsed.model.changes).toHaveLength(0)
    const text = reparsed.model.stories[0]?.paragraphs
      .flatMap((paragraph) => paragraph.runs.map((run) => run.text))
      .join('')
    expect(text).toContain('Commented text')
    expect(text).toContain('Alice Example overview')
  })

  it('refuses table revisions that keep deleted row text recoverable', async () => {
    const zip = await fixtureZip()
    const file = zip.file('word/document.xml')
    const source = (await file?.async('string')) ?? ''
    zip.file(
      'word/document.xml',
      source.replace(
        '<w:sectPr>',
        '<w:tbl><w:tr><w:trPr><w:cellDel w:id="50" w:author="SECRETAUTHOR" w:date="2026-01-01T00:00:00Z"/></w:trPr><w:tc><w:p><w:r><w:delText>SECRETDELETED row</w:delText></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr>',
      ),
    )
    const document = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('refuses revision markup carried by non-story parts', async () => {
    const zip = await fixtureZip()
    zip.file(
      'word/styles.xml',
      (await zip.file('word/styles.xml')?.async('string'))?.replace(
        '</w:styles>',
        '<w:style w:type="character" w:styleId="S"><w:rPr><w:rPrChange w:id="9" w:author="SECRETAUTHOR" w:date="2026-01-01T00:00:00Z"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr></w:style></w:styles>',
      ) ?? '',
    )
    const document = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('refuses section, numbering and customXml revision shapes', async () => {
    for (const fragment of [
      '<w:sectPrChange w:id="61" w:author="SECRETAUTHOR" w:date="2026-01-01T00:00:00Z"><w:sectPr/></w:sectPrChange>',
      '<w:customXmlIns w:id="62" w:author="SECRETAUTHOR" w:date="2026-01-01T00:00:00Z"><w:p/></w:customXmlIns>',
      '<w:moveFromRangeStart w:id="63" w:author="SECRETAUTHOR" w:date="2026-01-01T00:00:00Z" w:name="dangling"/>',
    ]) {
      const zip = await fixtureZip()
      const file = zip.file('word/document.xml')
      const source = (await file?.async('string')) ?? ''
      zip.file(
        'word/document.xml',
        source.replace('<w:sectPr>', `${fragment}<w:sectPr>`),
      )
      const document = await parseDocx(await zipBytes(zip))
      await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
        ShareSafeRefusal,
      )
    }
  })

  it('drops unreferenced parts instead of shipping them verbatim', async () => {
    const zip = await fixtureZip()
    zip.file(
      'word/payload.xml',
      '<?xml version="1.0"?><payload><secret>SECRETPAYLOAD client name</secret></payload>',
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)
    expect(parts.has('word/payload.xml')).toBe(false)
    for (const source of parts.values()) {
      expect(source).not.toContain('SECRETPAYLOAD')
    }
  })

  it('scrubs the part a core-properties relationship declares, wherever it sits', async () => {
    const zip = await fixtureZip()
    const root = zip.file('_rels/.rels')
    const rels = (await root?.async('string')) ?? ''
    zip.file(
      '_rels/.rels',
      rels.replace('docProps/core.xml', 'docProps/real-core.xml'),
    )
    const core = (await zip.file('docProps/core.xml')?.async('string')) ?? ''
    zip.remove('docProps/core.xml')
    zip.file(
      'docProps/real-core.xml',
      core.replace('Alice Example', 'SECRETPAYLOAD Author'),
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    // Wherever the source put it, the emitted part ships under its
    // canonical name — the source spelling never reaches the archive.
    const scrubbed = await partSource(bytes, 'docProps/core.xml')
    expect(scrubbed).not.toContain('SECRETPAYLOAD')
  })

  it('refuses case-variant part names a recipient could read ambiguously', async () => {
    const zip = await fixtureZip()
    zip.file(
      'DOCPROPS/CORE.XML',
      '<?xml version="1.0"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties"><cp:creator>SECRETPAYLOAD Author</cp:creator></cp:coreProperties>',
    )
    const document = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('refuses an external image relationship', async () => {
    const zip = await fixtureZip()
    await addDocumentRelationship(
      zip,
      `<Relationship Id="rId90" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://SECRETTRACKER.example/beacon.png" TargetMode="External"/>`,
    )
    const document = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('unlinks external hyperlinks while keeping their text', async () => {
    const zip = await fixtureZip()
    await addDocumentRelationship(
      zip,
      `<Relationship Id="rId91" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="file://SECRETSERVER/share" TargetMode="External"/>`,
    )
    const file = zip.file('word/document.xml')
    const source = (await file?.async('string')) ?? ''
    zip.file(
      'word/document.xml',
      source.replace(
        '<w:p><w:fldSimple w:instr=" STYLEREF',
        '<w:p><w:hyperlink r:id="rId91"><w:r><w:t>linked text</w:t></w:r></w:hyperlink></w:p><w:p><w:fldSimple w:instr=" STYLEREF',
      ),
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)
    expect(parts.get(DOCUMENT_RELS)).not.toContain('SECRETSERVER')
    expect(parts.get(DOCUMENT_RELS)).not.toContain('TargetMode="External"')
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('linked text')
    expect(story).not.toContain('r:id="rId91"')
  })

  it('detaches an external attachedTemplate relationship and element', async () => {
    const zip = await fixtureZip()
    await declarePart(zip, 'settings', 'settings.xml')
    zip.file(
      'word/settings.xml',
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:attachedTemplate r:id="rIdT"/><w:trackRevisions/></w:settings>',
    )
    zip.file(
      'word/_rels/settings.xml.rels',
      `<?xml version="1.0"?><Relationships xmlns="${REL_NS}"><Relationship Id="rIdT" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/attachedTemplate" Target="\\\\SECRETSERVER\\template.dotm" TargetMode="External"/></Relationships>`,
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)
    expect(parts.get('word/settings.xml')).not.toContain('attachedTemplate')
    expect(parts.has('word/_rels/settings.xml.rels')).toBe(false)
  })

  it('refuses fields that fetch external resources', async () => {
    const zip = await fixtureZip()
    const file = zip.file('word/document.xml')
    const source = (await file?.async('string')) ?? ''
    zip.file(
      'word/document.xml',
      source.replace(
        '<w:p><w:fldSimple w:instr=" STYLEREF',
        '<w:p><w:fldSimple w:instr=" INCLUDETEXT &quot;\\\\SECRETSERVER\\s.docx&quot; "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p><w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><wx:instrText xmlns:wx="http://schemas.openxmlformats.org/wordprocessingml/2006/main"> INCLUDEPICTURE "http://SECRETTRACKER.example/x.png" </wx:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>i</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p><w:p><w:fldSimple w:instr=" STYLEREF',
      ),
    )
    const document = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('clears app-property content carriers and settings provenance', async () => {
    const zip = await fixtureZip()
    zip.file(
      'docProps/app.xml',
      '<?xml version="1.0"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><TotalTime>413</TotalTime><Company>SECRETPAYLOAD LLP</Company><TitlesOfParts><vt:vector size="1"><vt:lpstr>SECRETPART Settlement Agreement</vt:lpstr></vt:vector></TitlesOfParts><HeadingPairs><vt:vector size="2"><vt:variant><vt:lpstr>x</vt:lpstr></vt:variant><vt:variant><vt:i4>1</vt:i4></vt:variant></vt:vector></HeadingPairs></Properties>',
    )
    const root = zip.file('_rels/.rels')
    zip.file(
      '_rels/.rels',
      ((await root?.async('string')) ?? '').replace(
        '</Relationships>',
        '<Relationship Id="rId70" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>',
      ),
    )
    await declarePart(zip, 'settings', 'settings.xml')
    zip.file(
      'word/settings.xml',
      '<?xml version="1.0"?><w:settings xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:trackRevisions/><w:docVars><w:docVar w:name="MatterRef" w:val="SECRETPAYLOAD-442"/></w:docVars><w:rsids><w:rsid w:val="00AA"/></w:rsids></w:settings>',
    )
    const file = zip.file('word/document.xml')
    zip.file(
      'word/document.xml',
      ((await file?.async('string')) ?? '').replace(
        '<w:r><w:t>Restarted list</w:t></w:r>',
        '<w:r w:rsidR="00AA"><w:t>Restarted list</w:t></w:r>',
      ),
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)
    const app = parts.get('docProps/app.xml') ?? ''
    expect(app).not.toContain('SECRETPAYLOAD')
    expect(app).not.toContain('SECRETPART')
    expect(app).not.toContain('TitlesOfParts')
    expect(app).not.toContain('HeadingPairs')
    expect(app).not.toContain('TotalTime')
    const settings = parts.get('word/settings.xml') ?? ''
    expect(settings).not.toContain('docVar')
    expect(settings).not.toContain('rsid')
    expect(parts.get('word/document.xml')).not.toContain('rsidR')
  })

  it('keeps only validated obiter properties in custom.xml', async () => {
    const zip = await fixtureZip()
    const file = zip.file('docProps/custom.xml')
    const custom = (await file?.async('string')) ?? ''
    zip.file(
      'docProps/custom.xml',
      custom.replace(
        '/>',
        '><property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="2" name="obiter.draft"><vt:bool xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">true</vt:bool></property>' +
          '<property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="3" name="obiter.smuggle"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">SECRETPAYLOAD</vt:lpwstr></property></Properties>',
      ),
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const out = await partSource(bytes, 'docProps/custom.xml')
    expect(out).toContain('obiter.draft')
    expect(out).not.toContain('obiter.smuggle')
    expect(out).not.toContain('SECRETPAYLOAD')
  })

  it('refuses a mistyped product property rather than passing it through', async () => {
    const zip = await fixtureZip()
    const file = zip.file('docProps/custom.xml')
    const custom = (await file?.async('string')) ?? ''
    zip.file(
      'docProps/custom.xml',
      custom.replace(
        '/>',
        '><property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="2" name="obiter.draft"><vt:lpwstr xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">SECRET</vt:lpwstr></property></Properties>',
      ),
    )
    const document = await parseDocx(await zipBytes(zip))
    await expect(buildShareSafeDocx(document)).rejects.toBeInstanceOf(
      ShareSafeRefusal,
    )
  })

  it('strips modern comments satellite parts instead of refusing', async () => {
    const zip = await fixtureZip()
    await addDocumentRelationship(
      zip,
      '<Relationship Id="rId71" Type="http://schemas.microsoft.com/office/2011/relationships/commentsExtended" Target="commentsExtended.xml"/><Relationship Id="rId72" Type="http://schemas.microsoft.com/office/2012/relationships/commentsIds" Target="commentsIds.xml"/><Relationship Id="rId73" Type="http://schemas.microsoft.com/office/2012/relationships/commentsExtensible" Target="commentsExtensible.xml"/>',
    )
    zip.file(
      'word/commentsExtended.xml',
      '<?xml version="1.0"?><w15:commentsEx xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"/>',
    )
    zip.file(
      'word/commentsIds.xml',
      '<?xml version="1.0"?><w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"/>',
    )
    zip.file(
      'word/commentsExtensible.xml',
      '<?xml version="1.0"?><w16cex:commentsExtensible xmlns:w16cex="http://schemas.microsoft.com/office/word/2018/wordml/cex"/>',
    )
    const document = await parseDocx(await zipBytes(zip))
    const bytes = await buildShareSafeDocx(document)
    const parts = await zipParts(bytes)
    expect(parts.has('word/commentsExtended.xml')).toBe(false)
    expect(parts.has('word/commentsIds.xml')).toBe(false)
    expect(parts.has('word/commentsExtensible.xml')).toBe(false)
    expect(parts.get(DOCUMENT_RELS)).not.toContain('commentsIds')
  })

  it('does not mutate the parsed source document', async () => {
    const document = await parseDocx(await withoutTrackedChanges())
    const before = [...document.sourceParts.keys()].sort()
    await buildShareSafeDocx(document)
    expect([...document.sourceParts.keys()].sort()).toEqual(before)
    for (const part of document.sourceParts.values()) {
      expect(part.dirty).toBe(false)
      expect(part.overlay?.replacements.size ?? 0).toBe(0)
    }
  })
})
