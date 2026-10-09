import { describe, expect, it } from 'bun:test'
import JSZip from 'jszip'

import { buildShareSafeDocx, parseDocx } from './index'
import {
  expectClean,
  expectRefusal,
  override,
  probePackage,
  rel,
  W,
} from './share-safe-probe-kit'

describe('share-safe probes: lexical channels the parser never models', () => {
  // Canonical emission rebuilds every part from the element tree, so
  // comments, processing instructions, unused xmlns bindings and
  // mc:Ignorable markers cannot ride the output.
  it.each([
    [
      'comment inside the document body',
      { body: '<!-- SECRETCOMMENT --><w:p><w:r><w:t>x</w:t></w:r></w:p>' },
    ],
    [
      'processing instruction inside the body',
      { body: '<?target SECRETPI?><w:p><w:r><w:t>x</w:t></w:r></w:p>' },
    ],
    [
      'unused namespace binding carrying a URI',
      {
        body: '<w:p xmlns:leak="http://SECRETURI/x"><w:r><w:t>x</w:t></w:r></w:p>',
      },
    ],
    [
      'mc:Ignorable naming a foreign prefix',
      {
        document: `<?xml version="1.0"?><w:document xmlns:w="${W}" xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" mc:Ignorable="SECRETIGNORABLE"><w:body><w:p><w:r><w:t>Visible.</w:t></w:r></w:p></w:body></w:document>`,
      },
    ],
    [
      'comment inside a relationships part',
      {
        documentRels:
          '<!-- SECRETRELSCOMMENT -->' + rel('rId9', 'styles', 'styles.xml'),
        overrides: override('/word/styles.xml', 'styles'),
        parts: {
          'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
        },
      },
    ],
    [
      'comment inside a kept settings part',
      {
        documentRels: rel('rId9', 'settings', 'settings.xml'),
        overrides: override('/word/settings.xml', 'settings'),
        parts: {
          'word/settings.xml': `<?xml version="1.0"?><w:settings xmlns:w="${W}"><!-- SECRETSETTINGSCOMMENT --><w:zoom w:percent="100"/></w:settings>`,
        },
      },
    ],
    [
      'comment before the document root',
      {
        document: `<?xml version="1.0"?><!-- SECRETROOTCOMMENT --><w:document xmlns:w="${W}"><w:body><w:p><w:r><w:t>Visible.</w:t></w:r></w:p></w:body></w:document>`,
      },
    ],
  ])('emits clean despite %s', async (_label, spec) => {
    await expectClean(spec, ['SECRET'])
  })

  it('refuses an unqualified attribute on a w: element', async () => {
    await expectRefusal({
      body: '<w:p secretnote="SECRETVALUE"><w:r><w:t>x</w:t></w:r></w:p>',
    })
  })
})

describe('share-safe probes: unknown and scoped markup', () => {
  it.each([
    [
      'an unknown w: element',
      '<w:p><w:futureCarrier w:val="SECRETPAYLOAD"><w:r><w:t>Visible.</w:t></w:r></w:futureCarrier></w:p>',
    ],
    [
      'documentProtection inside the body',
      '<w:p><w:documentProtection w:hashValue="SECRETHASH" w:saltValue="x"/></w:p>',
    ],
    [
      'a w14 revision element',
      '<w:p><w14:conflictIns w14:author="SECRETAUTHOR"><w:r><w:t>Visible.</w:t></w:r></w14:conflictIns></w:p>',
    ],
    [
      'a w14 conflict-delete element',
      '<w:p><w14:conflictDel w14:author="SECRETAUTHOR"><w:r><w:t>SECRETDELETED</w:t></w:r></w14:conflictDel></w:p>',
    ],
    [
      'an element in an unbounded word extension namespace',
      '<w:p><w15:marker w15:author="SECRETAUTHOR" xmlns:w15="http://schemas.microsoft.com/office/word/2012/wordml"><w:r><w:t>Visible.</w:t></w:r></w15:marker></w:p>',
    ],
    [
      'a w14 element carrying a w: author attribute',
      '<w:p><w14:x w:author="SECRETAUTHOR" xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"/></w:p>',
    ],
    [
      'w:binData inside a pict',
      '<w:p><w:r><w:pict><w:binData w:name="x">SECRETB64</w:binData></w:pict></w:r></w:p>',
    ],
    [
      'w:fldData inside a field',
      '<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> PAGE </w:instrText><w:fldData>SECRETFIELDDATA</w:fldData><w:fldChar w:fldCharType="end"/></w:r></w:p>',
    ],
    [
      'an unqualified relationship attribute on w:hyperlink',
      '<w:p><w:hyperlink docLocation="SECRETLOC"><w:r><w:t>x</w:t></w:r></w:hyperlink></w:p>',
    ],
    [
      'an unqualified instr attribute on w:fldSimple',
      '<w:p><w:fldSimple instr=" PAGE "><w:r><w:t>x</w:t></w:r></w:fldSimple></w:p>',
    ],
    [
      'w:attachedTemplate in the document body',
      '<w:p><w:attachedTemplate r:id="rId9"/></w:p>',
    ],
    [
      'a foreign graphicData payload uri',
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="SECRETURI"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
    ],
    [
      'a hidden drawing object',
      '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData><a:grpSpPr><a:cNvGrpSpPr name="x" descr="SECRETDESCR" hidden="1"/></a:grpSpPr></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
    ],
  ])('refuses %s', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'displacedBy run markers',
      '<w:p><w:r><w:rPr><w:displacedByIns/></w:rPr><w:t>Visible.</w:t></w:r></w:p>',
    ],
    [
      'a docPartGallery pointer inside sdtEndPr',
      '<w:sdt><w:sdtPr><w:rPr/></w:sdtPr><w:sdtEndPr><w:docPartGallery w:val="SECRETG"/></w:sdtEndPr><w:sdtContent><w:r><w:t>Visible.</w:t></w:r></w:sdtContent></w:sdt>',
    ],
    [
      'a textinput content control',
      '<w:sdt><w:sdtPr><w:text w:multiLine="1"/></w:sdtPr><w:sdtContent><w:r><w:t>Visible.</w:t></w:r></w:sdtContent></w:sdt>',
    ],
    [
      'table caption and description carriers',
      '<w:tbl><w:tblPr><w:tblCaption w:val="SECRETCAPTION"/><w:tblDescription w:val="SECRETDESC"/></w:tblPr><w:tr><w:tc><w:p><w:r><w:t>Cell.</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
    ],
    [
      'an xml:space text carrier',
      '<w:p><w:r><w:t xml:space="preserve"> spaced </w:t></w:r></w:p>',
    ],
  ])('emits clean for %s', async (_label, body) => {
    await expectClean({ body }, ['SECRET'])
  })
})

describe('share-safe probes: field spans', () => {
  it('removes an orphaned instrText marker', async () => {
    const document = await parseDocx(
      await probePackage({
        body: '<w:p><w:r><w:instrText> INCLUDETEXT "SECRET" </w:instrText></w:r></w:p>',
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    const story = await zip.file('word/document.xml')?.async('string')
    expect(story).not.toContain('SECRET')
    expect(story).not.toContain('instrText')
  })

  it.each([
    ['SET', ' SET x "SECRETSETVALUE" '],
    ['FILENAME', ' FILENAME \\p '],
  ])(
    'removes a %s field whole, cached result included',
    async (_name, instruction) => {
      const document = await parseDocx(
        await probePackage({
          body: `<w:p><w:r><w:fldChar w:fldCharType="begin"/><w:instrText>${instruction}</w:instrText><w:fldChar w:fldCharType="separate"/><w:t>SECRETRESULT</w:t><w:fldChar w:fldCharType="end"/></w:r></w:p>`,
        }),
      )
      const bytes = await buildShareSafeDocx(document)
      const zip = await JSZip.loadAsync(bytes)
      const story = await zip.file('word/document.xml')?.async('string')
      expect(story).not.toContain('SECRET')
      expect(story).toContain('Visible.')
    },
  )

  it('keeps a field span inside a removed subtree removed', async () => {
    await expectClean(
      {
        documentRels: rel('rId9', 'settings', 'settings.xml'),
        overrides: override('/word/settings.xml', 'settings'),
        parts: {
          'word/settings.xml': `<?xml version="1.0"?><w:settings xmlns:w="${W}"><w:trackRevisions><w:r><w:fldChar w:fldCharType="begin"/><w:instrText> INCLUDETEXT "SECRET" </w:instrText><w:fldChar w:fldCharType="end"/></w:r></w:trackRevisions></w:settings>`,
        },
      },
      ['SECRET'],
    )
  })
})

describe('share-safe probes: package-level escapes', () => {
  it('drops a stylesWithEffects part and its relationship', async () => {
    const document = await parseDocx(
      await probePackage({
        documentRels: rel('rId9', 'stylesWithEffects', 'stylesWithEffects.xml'),
        overrides: override('/word/stylesWithEffects.xml', 'stylesWithEffects'),
        parts: {
          'word/stylesWithEffects.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
        },
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    expect(zip.file('word/stylesWithEffects.xml')).toBeNull()
    const relsFile = zip.file('word/_rels/document.xml.rels')
    if (relsFile) {
      expect(await relsFile.async('string')).not.toContain('stylesWithEffects')
    }
  })

  it('drops a declared glossary document', async () => {
    await expectClean(
      {
        documentRels: rel('rId9', 'glossaryDocument', 'glossary/document.xml'),
        overrides: override('/word/glossary/document.xml', 'glossaryDocument'),
        parts: {
          'word/glossary/document.xml': `<?xml version="1.0"?><w:glossary xmlns:w="${W}"/>`,
        },
      },
      ['SECRET'],
    )
  })

  it('drops a commentsIds part and its relationship', async () => {
    const document = await parseDocx(
      await probePackage({
        documentRels: rel('rId9', 'commentsIds', 'commentsIds.xml'),
        overrides: override('/word/commentsIds.xml', 'commentsIds'),
        parts: {
          'word/commentsIds.xml': `<?xml version="1.0"?><w16cid:commentsIds xmlns:w16cid="http://schemas.microsoft.com/office/word/2016/wordml/cid"/>`,
        },
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    expect(zip.file('word/commentsIds.xml')).toBeNull()
  })

  it.each([
    [
      'a numPicBullet relationship',
      rel('rId9', 'numPicBullet', 'media/bullet1.png'),
      { 'word/media/bullet1.png': 'PNGDATA' } as Record<string, string>,
    ],
  ])('refuses %s', async (_label, documentRels, parts) => {
    await expectRefusal({ documentRels, parts })
  })

  it('refuses an image relationship whose payload is not an image', async () => {
    await expectRefusal({
      documentRels: rel('rId9', 'image', 'media/img1.png'),
      parts: { 'word/media/img1.png': 'SECRETPAYLOAD-NOT-AN-IMAGE' },
    })
  })

  it('strips metadata chunks from a kept PNG image', async () => {
    const png = new Uint8Array([
      0x89,
      0x50,
      0x4e,
      0x47,
      0x0d,
      0x0a,
      0x1a,
      0x0a,
      // IHDR: 13 bytes of data.
      0x00,
      0x00,
      0x00,
      0x0d,
      0x49,
      0x48,
      0x44,
      0x52,
      0x00,
      0x00,
      0x00,
      0x01,
      0x00,
      0x00,
      0x00,
      0x01,
      0x08,
      0x02,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00,
      0x00, // crc
      // tEXt chunk carrying a private string.
      0x00,
      0x00,
      0x00,
      0x0e,
      0x74,
      0x45,
      0x58,
      0x74,
      0x63,
      0x6f,
      0x6d,
      0x6d,
      0x65,
      0x6e,
      0x74,
      0x00,
      0x53,
      0x45,
      0x43,
      0x52,
      0x45,
      0x54,
      0x00,
      0x00,
      0x00,
      0x00, // crc
      // IDAT.
      0x00,
      0x00,
      0x00,
      0x02,
      0x49,
      0x44,
      0x41,
      0x54,
      0x78,
      0x9c,
      0x00,
      0x00,
      0x00,
      0x00, // crc
      // IEND.
      0x00,
      0x00,
      0x00,
      0x00,
      0x49,
      0x45,
      0x4e,
      0x44,
      0xae,
      0x42,
      0x60,
      0x82,
    ])
    const document = await parseDocx(
      await probePackage({
        documentRels: rel('rId9', 'image', 'media/img1.png'),
        body: '<w:p><w:r><w:drawing><wp:inline xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing"><a:graphic xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:blipFill><a:blip r:embed="rId9"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>',
        parts: { 'word/media/img1.png': png },
        overrides: '<Default Extension="png" ContentType="image/png"/>',
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    const emitted = await zip.file('word/media/img1.png')?.async('uint8array')
    if (emitted === undefined) throw new Error('image part missing')
    expect(new TextDecoder('latin1').decode(emitted)).not.toContain('SECRET')
    expect(emitted.length).toBeLessThan(png.length)
  })
})

describe('share-safe probes: bookmarks, anchors and markup compatibility', () => {
  it('renames a bookmark to a generated name', async () => {
    const document = await parseDocx(
      await probePackage({
        body: '<w:p><w:bookmarkStart w:id="1" w:name="SECRETBOOKMARK"/><w:bookmarkEnd w:id="1"/><w:r><w:t>Visible.</w:t></w:r></w:p>',
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    const story = await zip.file('word/document.xml')?.async('string')
    expect(story).not.toContain('SECRETBOOKMARK')
    expect(story).toContain('w:bookmarkStart')
  })

  it('rewrites an anchor that names a renamed bookmark', async () => {
    const document = await parseDocx(
      await probePackage({
        body: '<w:p><w:hyperlink w:anchor="SECRETBM"><w:r><w:t>Link.</w:t></w:r></w:hyperlink><w:bookmarkStart w:id="1" w:name="SECRETBM"/><w:bookmarkEnd w:id="1"/></w:p>',
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    const story = await zip.file('word/document.xml')?.async('string')
    expect(story).not.toContain('SECRETBM')
    expect(story).toContain('Link.')
    const anchor = story?.match(/w:anchor="([^"]+)"/u)?.[1]
    const name = story?.match(/w:bookmarkStart[^>]*w:name="([^"]+)"/u)?.[1]
    expect(anchor).toBe(name)
  })

  it('ships the provable mc:Choice branch of AlternateContent', async () => {
    const document = await parseDocx(
      await probePackage({
        body: `<w:p><w:r><mc:AlternateContent xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006"><mc:Choice xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" Requires="a"><w:drawing/></mc:Choice><mc:Fallback><w:t>SECRETFALLBACK</w:t></mc:Fallback></mc:AlternateContent></w:r></w:p>`,
      }),
    )
    const bytes = await buildShareSafeDocx(document)
    const zip = await JSZip.loadAsync(bytes)
    const story = await zip.file('word/document.xml')?.async('string')
    expect(story).toContain('w:drawing')
    expect(story).not.toContain('SECRETFALLBACK')
    expect(story).not.toContain('AlternateContent')
    expect(story).not.toContain('mc:')
  })
})
