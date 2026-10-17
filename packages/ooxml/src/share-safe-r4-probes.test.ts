import { describe, expect, it } from 'bun:test'

import { parseDocx } from './index'
import {
  A,
  expectClean,
  expectRefusal,
  MC,
  outputParts,
  override,
  PIC,
  probePackage,
  R,
  rel,
  W,
  W14,
  WP,
  type ProbeSpec,
} from './share-safe-probe-kit'

describe('share-safe r4: generic w: attribute channel', () => {
  it.each([
    ['w:val', '<w:p w:val="SECRETPAYLOAD"><w:r><w:t>x</w:t></w:r></w:p>'],
    ['w:name', '<w:p w:name="SECRETPAYLOAD"><w:r><w:t>x</w:t></w:r></w:p>'],
    ['w:id', '<w:p w:id="SECRETPAYLOAD"><w:r><w:t>x</w:t></w:r></w:p>'],
    ['w:uri', '<w:p w:uri="SECRETURI"><w:r><w:t>x</w:t></w:r></w:p>'],
    [
      'w:instr on a non-field element',
      '<w:p w:instr=" INCLUDETEXT SECRETPATH "><w:r><w:t>x</w:t></w:r></w:p>',
    ],
    [
      'w:anchor on a non-hyperlink element',
      '<w:p w:anchor="SECRETPAYLOAD"><w:r><w:t>x</w:t></w:r></w:p>',
    ],
    [
      'w:instr on w:instrText',
      '<w:p><w:r><w:instrText w:instr="SECRETPAYLOAD"> PAGE </w:instrText></w:r></w:p>',
    ],
  ])('%s out of element scope does not ship', async (_label, body) => {
    await expectClean({ body }, ['SECRET'])
  })

  it('a non-onoff w:val on a toggle element refuses the copy', async () => {
    await expectRefusal({
      body: '<w:p><w:pPr><w:keepNext w:val="SECRETPAYLOAD"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    })
  })

  it('keeps a declared w: attribute with a valid value', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:pPr><w:keepNext w:val="1"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    })
    expect(parts.get('word/document.xml')).toContain('w:val="1"')
  })
})

describe('share-safe r4: field and bookmark channels', () => {
  it('REF argument naming a shipped bookmark is renamed', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:bookmarkStart w:id="1" w:name="SECRETBM"/><w:bookmarkEnd w:id="1"/><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> REF SECRETBM </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRETBM')
    expect(story).toContain('REF bm1')
  })

  it('REF argument naming no shipped bookmark flattens the field', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> REF SECRETBMNAME </w:instrText><w:fldChar w:fldCharType="separate"/><w:t>cached</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRETBMNAME')
    expect(story).not.toContain('instrText')
    expect(story).not.toContain('fldChar')
    // The cached displayed result stays.
    expect(story).toContain('cached')
  })

  it('TC argument colliding with a bookmark name ships verbatim', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:bookmarkStart w:id="1" w:name="Cases"/><w:bookmarkEnd w:id="1"/><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> TC "Cases" </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    // The TC operand is content text, not a reference — only the bookmark
    // anchor is renamed.
    expect(story).toContain('TC "Cases"')
    expect(story).not.toContain('w:name="Cases"')
  })

  it('fldSimple REF argument is rewritten', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:bookmarkStart w:id="1" w:name="SECRETBM"/><w:bookmarkEnd w:id="1"/><w:fldSimple w:instr=" REF SECRETBM "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRETBM')
    expect(story).toContain('REF bm1')
  })

  it('fldSimple with entity-encoded refuse-class instruction refuses', async () => {
    await expectRefusal({
      body: '<w:p><w:fldSimple w:instr=" &#73;NCLUDETEXT x "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>',
    })
  })

  it('quoted-first-token instruction flattens, not ships', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> "INCLUDETEXT x" SECRETPAYLOAD </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRETPAYLOAD')
    expect(story).not.toContain('instrText')
  })

  it('unclosed keep-class field ships no machinery', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('fldChar')
    expect(story).not.toContain('instrText')
  })

  it('unclosed remove-class field refuses', async () => {
    await expectRefusal({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> SET x "SECRETVAL" </w:instrText></w:r></w:p>',
    })
  })

  it('keeps a keep-class field whose whole result is a comment marker', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:commentReference w:id="1"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    // The comment surface is not the author's field content, so its removal
    // must not close the span: the field ships with an empty result rather
    // than taking its instruction with it.
    expect(story).toContain('PAGE')
    expect(story).toContain('fldChar')
    expect(story).not.toContain('commentReference')
  })

  it('collapses an annotation-reference run rather than shipping an empty shell', async () => {
    // `annotationRef` is the other reference a run can hold alone. The marker is
    // removed with the comments surface, and once it goes the run carries
    // nothing: the field around it must keep its instruction without leaving a
    // dead `<w:r/>` where its result was.
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:annotationRef/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('PAGE')
    expect(story).not.toContain('annotationRef')
    // Every other run in this story carries content, so any run left empty is
    // the shell that the emptied annotation run used to become.
    expect(story).not.toMatch(/<w:r\s*\/>|<w:r\s*><\/w:r>/)
  })

  it('collapses a run left holding only a range marker', async () => {
    // A range marker is the same kind of surface: the element pass removes it,
    // and a run that held nothing else is then a dead shell. Conforming markup
    // puts range markers between runs, but the parser accepts them inside one —
    // this file's own comment-range case builds that — so the shell is real.
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:t>a</w:t></w:r><w:r><w:commentRangeEnd w:id="1"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('commentRangeEnd')
    expect(story).not.toMatch(/<w:r\s*\/>|<w:r\s*><\/w:r>/)
  })

  it('keeps character data a run writes beside a range marker', async () => {
    // The empty-text check is the only guard for this shape. Character data is
    // not an element, so the carries set never sees it, and collapsing the run
    // would delete `BARE` from the document.
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:commentRangeStart w:id="1"/>BARE<w:commentRangeEnd w:id="1"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('BARE')
    expect(story).not.toContain('commentRange')
  })

  it('collapses a run left holding only its formatting', async () => {
    // The shell a collapse removes can carry the run's properties, so the run is
    // not always literally empty: a formatted marker run leaves
    // `<w:r><w:rPr>…</w:rPr></w:r>` unless the collapse takes it. The empty-run
    // regex in the case above would not match that.
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:rPr><w:rStyle w:val="CommentReference"/></w:rPr><w:annotationRef/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('annotationRef')
    expect(story).not.toContain('CommentReference')
    // The run itself has to go, not just its contents: dropping the properties
    // and keeping the run would leave `<w:r/>`, and stripping the marker while
    // keeping `<w:r><w:rPr>…</w:rPr></w:r>` would leave a shell the two name
    // assertions above cannot see.
    expect(story).not.toMatch(/<w:r\s*\/>|<w:r\s*><\/w:r>/)
    expect(story).not.toMatch(
      /<w:r(?:\s[^>]*)?>\s*<w:rPr>[\s\S]*?<\/w:rPr>\s*<\/w:r>/,
    )
  })

  it('keeps a keep-class field whose result carries text beside a comment marker', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>7</w:t></w:r><w:r><w:commentReference w:id="1"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('PAGE')
    expect(story).toContain('7')
    expect(story).not.toContain('commentReference')
  })

  it('keeps a keep-class field whose result carries a comment range', async () => {
    // The usual shape when a comment is anchored on a field's result.
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:commentRangeStart w:id="1"/><w:t>7</w:t><w:commentRangeEnd w:id="1"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('PAGE')
    expect(story).toContain('7')
    expect(story).not.toContain('commentRange')
  })

  it('still closes a keep-class field half-removed beside a comment marker', async () => {
    // A comment marker alone no longer closes the span, but a real trigger must
    // still do so: the exclusion must not become a way for a partial field to
    // ship.
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:commentReference w:id="1"/></w:r><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText> SET x "SECRETVAL" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('PAGE')
    expect(story).not.toContain('SECRETVAL')
  })

  it('SET field nested inside a kept field is dropped', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> QUOTE </w:instrText><w:fldChar w:fldCharType="begin"/><w:instrText> SET x "SECRETVAL" </w:instrText><w:fldChar w:fldCharType="end"/><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRETVAL')
    expect(story).not.toContain('SET')
  })
})

describe('share-safe r4: lexical emitter', () => {
  it('CDATA literal entity-looking text stays literal', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:t><![CDATA[a&#60;b]]></w:t></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('<w:t>a&amp;#60;b</w:t>')
  })

  it('CDATA markup-looking text is escaped', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:t><![CDATA[<x>MARKUP</x>]]></w:t></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('&lt;x&gt;MARKUP&lt;/x&gt;')
  })

  it(']]> in text emits escaped', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:t>MARK]]&gt;ER</w:t></w:r></w:p>',
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('MARK]]&gt;ER')
  })

  it('foreign-namespace attribute carrying a reference does not ship', async () => {
    const { parts } = await outputParts({
      body: '<w:p><w:r><w:t w16sdtdh:placeholder="&#60;SECRET&#62;" xmlns:w16sdtdh="urn:probe">y</w:t></w:r></w:p>',
    })
    expect(parts.get('word/document.xml') ?? '').not.toContain('SECRET')
  })

  it('unknown entity reference fails at parse', async () => {
    await expect(
      parseDocx(
        await probePackage({
          body: '<w:p><w:r><w:t>a&sec;b</w:t></w:r></w:p>',
        }),
      ),
    ).rejects.toThrow()
  })

  it('&#0; control reference fails at parse', async () => {
    await expect(
      parseDocx(
        await probePackage({
          body: '<w:p><w:r><w:t>a&#0;b</w:t></w:r></w:p>',
        }),
      ),
    ).rejects.toThrow()
  })

  it('text after the root fails at parse', async () => {
    await expect(
      parseDocx(
        await probePackage({
          document: `<?xml version="1.0"?><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Visible.</w:t></w:r></w:p></w:body></w:document>SECRETTAIL`,
        }),
      ),
    ).rejects.toThrow()
  })

  it('20k-deep nesting terminates', async () => {
    const depth = 20000
    const open = '<w:p>'.repeat(depth)
    const close = '</w:p>'.repeat(depth)
    const spec: ProbeSpec = { body: `${open}<w:r><w:t>x</w:t></w:r>${close}` }
    const result: Awaited<ReturnType<typeof outputParts>> | Error =
      await outputParts(spec).catch((error: unknown) => error as Error)
    // Termination is the assertion: a clean emit or a bounded refusal.
    if (!(result instanceof Error)) {
      expect(result.parts.get('word/document.xml')).toContain('x')
    }
  })
})

describe('share-safe r4: package declarations', () => {
  it('nested Relationship element refuses', async () => {
    await expectRefusal({
      documentRels: `<Relationship Id="rId9" Type="${R}/styles" Target="styles.xml"><Relationship Id="x" Type="y" Target="z"/></Relationship>`,
    })
  })

  it('duplicate relationship ids refuse', async () => {
    await expectRefusal({
      documentRels:
        rel('rId9', 'styles', 'styles.xml') +
        rel('rId9', 'numbering', 'numbering.xml'),
      overrides:
        override('/word/styles.xml', 'styles') +
        override('/word/numbering.xml', 'numbering'),
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
        'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="${W}"/>`,
      },
    })
  })

  it('a unique type declared twice to the same target ships', async () => {
    const { parts } = await outputParts({
      documentRels:
        rel('rId9', 'numbering', 'numbering.xml') +
        rel('rId10', 'numbering', 'numbering.xml'),
      overrides: override('/word/numbering.xml', 'numbering'),
      parts: {
        'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="${W}"/>`,
      },
    })
    const rels = parts.get('word/_rels/document.xml.rels') ?? ''
    // Canonical emission renumbers declarations `rId1`, `rId2`, … in
    // document order — the source ids never reach emitted bytes.
    expect(rels).toContain('Id="rId1"')
    expect(rels).toContain('Id="rId2"')
    expect(rels).not.toContain('Id="rId9"')
    expect(rels).not.toContain('Id="rId10"')
  })

  it('a unique type declared under two targets refuses', async () => {
    await expectRefusal({
      documentRels:
        rel('rId9', 'numbering', 'numbering.xml') +
        rel('rId10', 'numbering', 'numbering2.xml'),
      overrides:
        override('/word/numbering.xml', 'numbering') +
        override('/word/numbering2.xml', 'numbering'),
      parts: {
        'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="${W}"/>`,
        'word/numbering2.xml': `<?xml version="1.0"?><w:numbering xmlns:w="${W}"/>`,
      },
    })
  })

  it('a duplicate Override naming the same type dedupes', async () => {
    const { parts } = await outputParts({
      overrides: override('/word/document.xml', 'document.main'),
    })
    const types = parts.get('[Content_Types].xml') ?? ''
    expect(types.match(/PartName="\/word\/document\.xml"/gu)).toHaveLength(1)
  })

  it('a duplicate Override carrying a different type refuses', async () => {
    await expectRefusal({
      overrides:
        '<Override PartName="/word/document.xml" ContentType="application/x-foreign"/>',
    })
  })

  it('a duplicate Default carrying a different type refuses', async () => {
    await expectRefusal({
      defaults:
        '<Default Extension="xml" ContentType="application/x-foreign"/>',
    })
  })

  it('kept image part without a content-type declaration refuses', async () => {
    const png = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
      0x49, 0x48, 0x44, 0x52, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x02, 0x49, 0x44, 0x41, 0x54, 0x78, 0x9c, 0x00, 0x00, 0x00, 0x00, 0x00,
      0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    await expectRefusal({
      documentRels: rel('rId9', 'image', 'media/i.png'),
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      parts: { 'word/media/i.png': png },
    })
  })
})

describe('share-safe r4: markup compatibility', () => {
  it('w14 Choice with no Fallback refuses', async () => {
    await expectRefusal({
      body: `<w:p><w:r><mc:AlternateContent><mc:Choice xmlns:w14="${W14}" Requires="w14"><w:p/></mc:Choice></mc:AlternateContent></w:r></w:p>`,
    })
  })

  it('w14 Choice falls back', async () => {
    const { parts } = await outputParts({
      body: `<w:p><w:r><mc:AlternateContent><mc:Choice xmlns:w14="${W14}" Requires="w14"><w:p/></mc:Choice><mc:Fallback><w:t>FB</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('FB')
    expect(story).not.toContain('AlternateContent')
  })

  it('nested mc:Choice inside a chosen branch refuses', async () => {
    await expectRefusal({
      body: `<w:p><w:r><mc:AlternateContent><mc:Choice Requires="w"><w:r><mc:Choice Requires="w"><w:t>NESTED</w:t></mc:Choice></w:r></mc:Choice><mc:Fallback><w:t>x</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
    })
  })

  it('AlternateContent inside a rels part refuses', async () => {
    await expectRefusal({
      documentRels: `<mc:AlternateContent xmlns:mc="${MC}"><mc:Choice Requires="w">${rel('rId9', 'styles', 'styles.xml')}</mc:Choice></mc:AlternateContent>`,
      overrides: override('/word/styles.xml', 'styles'),
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
      },
    })
  })
})
