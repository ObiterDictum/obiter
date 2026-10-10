import { describe, expect, it } from 'bun:test'

import type { SourcePart } from './model'
import { checkShareSafeXmlBytes } from './share-safe-bytecheck'
import {
  A,
  expectRefusal,
  outputParts,
  override,
  PIC,
  R,
  rel,
  W,
  WP,
} from './share-safe-probe-kit'

/**
 * R7 declarations and byte-level mirror: `.rels` and `[Content_Types].xml`
 * carry only the grammar OPC declares — IDs, URI-shaped values and the
 * two `TargetMode` spellings — and every bound the transform applies is
 * re-derived from the emitted bytes, so a writer splice faces the same
 * refusal. The shared harness and needle conventions match
 * `share-safe-r7-probes.test.ts`.
 */
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'

const DRAW = (inner: string) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">${inner}</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
const SPPR = (inner: string) => DRAW(`<pic:spPr>${inner}</pic:spPr>`)
const OML = (inner: string) => `<m:oMath xmlns:m="${M}">${inner}</m:oMath>`
const FILL = (child: string) =>
  SPPR(
    `<a:solidFill><a:srgbClr val="FF0000">${child}</a:srgbClr></a:solidFill>`,
  )

describe('share-safe r7: declaration grammar', () => {
  it.each([
    [
      'a relationship Id that is not an xsd:ID',
      rel('9rId', 'styles', 'styles.xml'),
    ],
    ['a relationship Id with a colon', rel('r:Id9', 'styles', 'styles.xml')],
    [
      'a relationship Target carrying whitespace',
      rel('rId9', 'styles', 'word /styles.xml'),
    ],
    [
      'a relationship Type carrying whitespace',
      `<Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/ styles" Target="styles.xml"/>`,
    ],
    [
      'a lowercase external TargetMode on a kept relationship',
      rel('rId9', 'styles', 'styles.xml', ' TargetMode="external"'),
    ],
    [
      'a fabricated TargetMode value',
      rel('rId9', 'styles', 'styles.xml', ' TargetMode="SECRETMODE"'),
    ],
    [
      'an External TargetMode on a kept relationship',
      rel('rId9', 'styles', 'styles.xml', ' TargetMode="External"'),
    ],
  ])('%s refuses the copy', async (_label, relationship) => {
    await expectRefusal({
      documentRels: relationship,
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
      },
      overrides: override('/word/styles.xml', 'styles'),
    })
  })

  it('stray text inside a .rels part refuses', async () => {
    await expectRefusal({
      parts: {
        'word/_rels/document.xml.rels': `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${rel('rId9', 'styles', 'styles.xml')}SECRETTEXT</Relationships>`,
      },
    })
  })

  it('text inside a Relationship element refuses', async () => {
    await expectRefusal({
      documentRels: `<Relationship Id="rId9" Type="${R}/styles" Target="styles.xml">SECRETTEXT</Relationship>`,
    })
  })

  it.each([
    [
      'a Default with a fabricated extension',
      {
        defaults:
          '<Default Extension="SECRET EXT" ContentType="application/xml"/>',
      },
    ],
    [
      'a Default with no media-type shape',
      { defaults: '<Default Extension="png" ContentType="not-a-media-type"/>' },
    ],
    [
      'an Override with a relative PartName',
      {
        overrides:
          '<Override PartName="word/evil.xml" ContentType="application/xml"/>',
      },
    ],
    [
      'an Override with no media-type shape',
      {
        overrides: '<Override PartName="/word/evil.xml" ContentType="SECRET"/>',
      },
    ],
  ])('%s refuses the copy', async (_label, spec) => {
    await expectRefusal(spec)
  })

  it('stray text inside [Content_Types].xml refuses', async () => {
    await expectRefusal({
      parts: {
        '[Content_Types].xml': `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>SECRETTEXT</Types>`,
      },
    })
  })

  it('a well-formed Internal TargetMode survives as an omitted attribute', async () => {
    const { parts } = await outputParts({
      documentRels: rel(
        'rId9',
        'styles',
        'styles.xml',
        ' TargetMode="Internal"',
      ),
      parts: {
        'word/styles.xml': `<?xml version="1.0"?><w:styles xmlns:w="${W}"/>`,
      },
      overrides: override('/word/styles.xml', 'styles'),
    })
    const rels = parts.get('word/_rels/document.xml.rels') ?? ''
    // Only internal relationships ship, so canonical emission leaves the
    // attribute off entirely — the emitted id is the generated `rId1`.
    expect(rels).toContain('Id="rId1"')
    expect(rels).toContain('Target="styles.xml"')
    expect(rels).not.toContain('TargetMode')
  })
})

describe('share-safe r7: preset enumerations against dml-main.xsd', () => {
  it.each([
    [
      'geometry leftDownArrow (invented)',
      SPPR('<a:prstGeom prst="leftDownArrow"/>'),
    ],
    ['geometry stopSign (invented)', SPPR('<a:prstGeom prst="stopSign"/>')],
    [
      'camera isometricOffAxis4Top (invented)',
      SPPR('<a:scene3d><a:camera prst="isometricOffAxis4Top"/></a:scene3d>'),
    ],
    [
      'camera obliqueFront (invented)',
      SPPR('<a:scene3d><a:camera prst="obliqueFront"/></a:scene3d>'),
    ],
    [
      'camera perspectiveTop (invented)',
      SPPR('<a:scene3d><a:camera prst="perspectiveTop"/></a:scene3d>'),
    ],
    ['material none (invented)', SPPR('<a:sp3d prstMaterial="none"/>')],
    [
      'pattern horzWave (invented)',
      SPPR(
        '<a:pattFill prst="horzWave"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr><a:bgClr><a:srgbClr val="0000FF"/></a:bgClr></a:pattFill>',
      ),
    ],
    [
      'warp textWave3 (invented)',
      SPPR('<a:txBody><a:bodyPr prstTxWarp="textWave3"/></a:txBody>'),
    ],
    [
      'sysClr face3d (transitional alias)',
      SPPR('<a:solidFill><a:sysClr val="face3d"/></a:solidFill>'),
    ],
    [
      'sysClr scrollbar (transitional alias)',
      SPPR('<a:solidFill><a:sysClr val="scrollbar"/></a:solidFill>'),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'geometry bentConnector3',
      SPPR('<a:prstGeom prst="bentConnector3"/>'),
      'prst="bentConnector3"',
    ],
    [
      'geometry wedgeRoundRectCallout',
      SPPR('<a:prstGeom prst="wedgeRoundRectCallout"/>'),
      'prst="wedgeRoundRectCallout"',
    ],
    [
      'pattern dnDiag',
      SPPR(
        '<a:pattFill prst="dnDiag"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr><a:bgClr><a:srgbClr val="0000FF"/></a:bgClr></a:pattFill>',
      ),
      'prst="dnDiag"',
    ],
    [
      'pattern zigZag',
      SPPR(
        '<a:pattFill prst="zigZag"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr><a:bgClr><a:srgbClr val="0000FF"/></a:bgClr></a:pattFill>',
      ),
      'prst="zigZag"',
    ],
    [
      'warp textDoubleWave1',
      SPPR('<a:txBody><a:bodyPr prstTxWarp="textDoubleWave1"/></a:txBody>'),
      'prstTxWarp="textDoubleWave1"',
    ],
    [
      'sysClr 3dDkShadow',
      SPPR(
        '<a:solidFill><a:sysClr val="3dDkShadow" lastClr="404040"/></a:solidFill>',
      ),
      'val="3dDkShadow"',
    ],
    [
      'sysClr scrollBar',
      SPPR(
        '<a:solidFill><a:sysClr val="scrollBar" lastClr="C0C0C0"/></a:solidFill>',
      ),
      'val="scrollBar"',
    ],
    [
      'prstClr grey spelling',
      SPPR('<a:solidFill><a:prstClr val="dkSlateGrey"/></a:solidFill>'),
      'val="dkSlateGrey"',
    ],
    [
      'autonum ea1JpnKorPlain',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:buAutoNum type="ea1JpnKorPlain"/></a:pPr></a:p></a:txBody>',
      ),
      'type="ea1JpnKorPlain"',
    ],
    [
      'underline dotDash',
      SPPR(
        '<a:txBody><a:p><a:r><a:rPr u="dotDash"/><a:t>x</a:t></a:r></a:p></a:txBody>',
      ),
      'u="dotDash"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})

describe('share-safe r7: byte-level mirror', () => {
  const part: SourcePart = {
    name: 'word/document.xml',
    kind: 'xml',
    role: 'story',
    originalPayload: new Uint8Array(),
    dirty: false,
    trackedChanges: [],
  }
  const relsPart: SourcePart = {
    name: 'word/_rels/document.xml.rels',
    kind: 'xml',
    role: 'relationships',
    originalPayload: new Uint8Array(),
    dirty: false,
    trackedChanges: [],
  }
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:m="${M}" xmlns:wp="${WP}" xmlns:pic="${PIC}"><w:body>${body}</w:body></w:document>`
  const refuse = (source: string) => () => checkShareSafeXmlBytes(part, source)
  const refuseRels = (source: string) => () =>
    checkShareSafeXmlBytes(relsPart, source)

  it.each([
    [
      'a signed alpha spliced into emitted bytes',
      xml(FILL('<a:alpha val="-5"/>')),
    ],
    [
      'a percent-literal zero alpha spliced into emitted bytes',
      xml(FILL('<a:alpha val="0%"/>')),
    ],
    [
      'an alphaRepl zero spliced into emitted bytes',
      xml(FILL('<a:alphaRepl a="0"/>')),
    ],
    [
      'an alphaBiLevel without thresh spliced into emitted bytes',
      xml(FILL('<a:alphaBiLevel/>')),
    ],
    [
      'a prstGeom without prst spliced into emitted bytes',
      xml(SPPR('<a:prstGeom/>')),
    ],
    [
      'an invented geometry token spliced into emitted bytes',
      xml(SPPR('<a:prstGeom prst="stopSign"/>')),
    ],
    [
      'an invented m:type token spliced into emitted bytes',
      xml(OML('<m:f><m:fPr><m:type m:val="skewed"/></m:fPr></m:f>')),
    ],
    [
      'an m:chr without m:val spliced into emitted bytes',
      xml(OML('<m:nary><m:naryPr><m:chr/></m:naryPr></m:nary>')),
    ],
    [
      'an invented m:dist element value spliced into emitted bytes',
      xml(OML('<m:dist m:val="1"/>')),
    ],
  ])('%s refuses', async (_label, source) => {
    expect(refuse(source)).toThrow()
  })

  it.each([
    [
      'a relationship Id that is not an xsd:ID',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="9bad" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'a relationship missing Target',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles"/></Relationships>`,
    ],
    [
      'a malformed TargetMode',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml" TargetMode="external"/></Relationships>`,
    ],
    [
      'a Default with no media type',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="SECRET"/></Types>`,
    ],
    [
      'an Override with a relative PartName',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Override PartName="word/evil.xml" ContentType="application/xml"/></Types>`,
    ],
  ])('%s refuses', async (_label, source) => {
    expect(refuseRels(source)).toThrow()
  })

  it('a schema-shaped package verifies', () => {
    expect(
      refuse(
        xml(
          FILL('<a:alpha val="50%"/><a:alphaRepl a="80000"/>') +
            OML('<m:f><m:fPr><m:type m:val="skw"/></m:fPr></m:f>'),
        ),
      ),
    ).not.toThrow()
    expect(
      refuseRels(
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
      ),
    ).not.toThrow()
  })

  it.each([
    [
      'a relationship id that is not the next canonical ordinal',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId2" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'a source-spelled relationship id in emitted bytes',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="${R}/styles" Target="styles.xml"/></Relationships>`,
    ],
    [
      'a TargetMode spliced into emitted bytes',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml" TargetMode="Internal"/></Relationships>`,
    ],
    [
      'an absolute Target spliced into emitted bytes',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="/word/styles.xml"/></Relationships>`,
    ],
    [
      'a qualified attribute spliced onto a Relationship',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml" x:marker="SECRETSPLICE"/></Relationships>`,
    ],
    [
      'text bytes between declarations',
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${R}/styles" Target="styles.xml"/>SECRETSPLICE</Relationships>`,
    ],
  ])('%s refuses', async (_label, source) => {
    expect(refuseRels(source)).toThrow()
  })

  it('a non-canonical emitted part name refuses', () => {
    const foreign: SourcePart = { ...part, name: 'word/secret name.xml' }
    expect(() => checkShareSafeXmlBytes(foreign, xml('<w:p/>'))).toThrow()
  })

  it('a qualified r: attribute with a non-canonical value refuses', () => {
    expect(
      refuse(
        xml(
          '<w:p><w:hyperlink r:id="rIdNine"><w:r><w:t>x</w:t></w:r></w:hyperlink></w:p>',
        ),
      ),
    ).toThrow()
  })
})
