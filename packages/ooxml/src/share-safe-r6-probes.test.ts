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
 * R6: attribute *values*, not just names and scopes. Every declared slot
 * resolves through a shared bound — an enumeration or grammar a value
 * must satisfy — and a declared slot holding an out-of-bound value
 * refuses the copy rather than stripping or preserving it. The byte
 * mirror re-derives each verdict from the emitted source.
 */
const M = 'http://schemas.openxmlformats.org/officeDocument/2006/math'
const A14 = 'http://schemas.microsoft.com/office/drawing/2010/main'
const CP =
  'http://schemas.openxmlformats.org/officeDocument/2006/custom-properties'
const VT =
  'http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes'

const DRAW = (inner: string) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">${inner}</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
const SPPR = (inner: string) => DRAW(`<pic:spPr>${inner}</pic:spPr>`)
const OML = (inner: string) => `<m:oMath xmlns:m="${M}">${inner}</m:oMath>`

const customProperties = (propertyXml: string) => ({
  parts: {
    'docProps/custom.xml': `<?xml version="1.0"?><Properties xmlns="${CP}" xmlns:vt="${VT}">${propertyXml}</Properties>`,
  },
  rootRels: rel('rId9', 'custom-properties', 'docProps/custom.xml'),
  overrides:
    '<Override PartName="/docProps/custom.xml" ContentType="application/vnd.openxmlformats-officedocument.custom-properties+xml"/>',
})
const marking = (name: string, vtType: string, value: string) =>
  `<property fmtid="{D5CDD505-2E9C-101B-9997-08002B2B79F9}" pid="2" name="${name}"><vt:${vtType}>${value}</vt:${vtType}></property>`

describe('share-safe r6: w: attribute value bounds', () => {
  it.each([
    [
      'w:jc val',
      '<w:p><w:pPr><w:jc w:val="SECRETJC"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    ],
    [
      'w:sz val',
      '<w:p><w:r><w:rPr><w:sz w:val="SECRETSZ"/></w:rPr><w:t>x</w:t></w:r></w:p>',
    ],
    [
      'w:rFonts hint',
      '<w:p><w:r><w:rPr><w:rFonts w:hint="SECRETHINT"/></w:rPr><w:t>x</w:t></w:r></w:p>',
    ],
    ['w:pgSz w', '<w:sectPr><w:pgSz w:w="SECRETW"/></w:sectPr>'],
    [
      'w:bdr val',
      '<w:p><w:pPr><w:pBdr><w:top w:val="SECRETBORDER"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
    ],
  ])('%s outside its bound refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'w:numFmt val in numbering',
      'word/numbering.xml',
      `<?xml version="1.0"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="SECRETFMT"/><w:lvlText w:val="SECRETLVL"/></w:lvl></w:abstractNum></w:numbering>`,
      rel('rId2', 'numbering', 'numbering.xml'),
      override('/word/numbering.xml', 'numbering'),
    ],
    [
      'w:zoom percent in settings',
      'word/settings.xml',
      `<?xml version="1.0"?><w:settings xmlns:w="${W}"><w:zoom w:percent="SECRETZOOM"/></w:settings>`,
      rel('rId2', 'settings', 'settings.xml'),
      override('/word/settings.xml', 'settings'),
    ],
  ])(
    '%s outside its bound refuses the copy',
    async (_label, part, source, relationship, types) => {
      await expectRefusal({
        parts: { [part]: source },
        documentRels: relationship,
        overrides: types,
      })
    },
  )

  it.each([
    [
      'w:jc keeps a declared justification',
      '<w:p><w:pPr><w:jc w:val="both"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
      'w:jc w:val="both"',
    ],
    [
      'w:sz keeps a declared size',
      '<w:p><w:r><w:rPr><w:sz w:val="24"/></w:rPr><w:t>x</w:t></w:r></w:p>',
      'w:sz w:val="24"',
    ],
    [
      'w:rFonts keeps a declared hint',
      '<w:p><w:r><w:rPr><w:rFonts w:ascii="Calibri" w:hint="eastAsia"/></w:rPr><w:t>x</w:t></w:r></w:p>',
      'w:hint="eastAsia"',
    ],
    [
      'w:bdr keeps a declared border value',
      '<w:p><w:pPr><w:pBdr><w:top w:val="single" w:sz="4" w:color="000000"/></w:pBdr></w:pPr><w:r><w:t>x</w:t></w:r></w:p>',
      'w:val="single"',
    ],
  ])('%s', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })

  it('numbering keeps declared values', async () => {
    const { parts } = await outputParts({
      parts: {
        'word/numbering.xml': `<?xml version="1.0"?><w:numbering xmlns:w="${W}"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num></w:numbering>`,
      },
      documentRels: rel('rId2', 'numbering', 'numbering.xml'),
      overrides: override('/word/numbering.xml', 'numbering'),
    })
    expect(parts.get('word/numbering.xml')).toContain('w:val="decimal"')
    expect(parts.get('word/numbering.xml')).toContain('w:val="%1."')
  })
})

describe('share-safe r6: extension URIs', () => {
  it.each([
    [
      'a schema URL with a free path',
      'https://schemas.microsoft.com/office/word/2010/SECRETPATH',
    ],
    ['an unknown GUID', '{C183D7F6-B498-43B3-948B-1728B52AA6E4}'],
    ['a foreign host', 'https://secret.invalid/x'],
  ])('%s removes the extension whole', async (_label, uri) => {
    const { parts } = await outputParts({
      body: SPPR(`<a:extLst><a:ext uri="${uri}"/></a:extLst>`),
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('<a:ext ')
    expect(story).not.toContain('SECRET')
  })

  it('the known useLocalDpi extension ships', async () => {
    const { parts } = await outputParts({
      body: SPPR(
        `<a:extLst><a:ext uri="{28A0092B-C50C-407E-A947-70E740481C1C}"><a14:useLocalDpi xmlns:a14="${A14}" val="0"/></a:ext></a:extLst>`,
      ),
    })
    expect(parts.get('word/document.xml')).toContain('a14:useLocalDpi val="0"')
  })
})

describe('share-safe r6: OMML value bounds', () => {
  it.each([
    [
      'm:chr on nary',
      OML('<m:nary><m:naryPr><m:chr m:val="SECRETNARY"/></m:naryPr></m:nary>'),
    ],
    [
      'm:subHide flag',
      OML(
        '<m:sSub><m:sSubPr><m:subHide m:val="SECRETSUB"/></m:sSubPr></m:sSub>',
      ),
    ],
    [
      'm:sty on a run',
      OML('<m:r><m:rPr><m:sty m:val="SECRETSTY"/></m:rPr><m:t>x</m:t></m:r>'),
    ],
    [
      'm:val on an element that declares none',
      OML('<m:e m:val="SECRETVAL"><m:r><m:t>x</m:t></m:r></m:e>'),
    ],
    [
      'm:limLoc value',
      OML(
        '<m:limLow><m:limLowPr><m:limLoc m:val="SECRETLOC"/></m:limLowPr></m:limLow>',
      ),
    ],
  ])('%s outside its bound refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'm:begChr keeps a delimiter glyph',
      OML(
        '<m:d><m:dPr><m:begChr m:val="["/><m:endChr m:val="]"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d>',
      ),
      'm:begChr m:val="["',
    ],
    [
      'm:limLoc keeps its enumeration',
      OML(
        '<m:nary><m:naryPr><m:chr m:val="&#8721;"/><m:limLoc m:val="undOvr"/></m:naryPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:nary>',
      ),
      'm:limLoc m:val="undOvr"',
    ],
    [
      'm:subHide keeps a flag',
      OML(
        '<m:sSub><m:sSubPr><m:subHide m:val="0"/></m:sSubPr><m:e><m:r><m:t>a</m:t></m:r></m:e><m:sub><m:r><m:t>b</m:t></m:r></m:sub></m:sSub>',
      ),
      'm:subHide m:val="0"',
    ],
    [
      'm:mathFont keeps a font name',
      OML('<m:r><m:rPr><m:nor/></m:rPr><m:t>x</m:t></m:r>'),
      'm:nor',
    ],
  ])('%s', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })

  it('an OMML phantom refuses as hidden content', async () => {
    await expectRefusal({
      body: OML(
        '<m:phant><m:phantPr><m:show m:val="0"/></m:phantPr><m:e><m:r><m:t>SECRETPHANTOM</m:t></m:r></m:e></m:phant>',
      ),
    })
  })
})

describe('share-safe r6: preset value bounds', () => {
  it.each([
    ['prstGeom prst', SPPR('<a:prstGeom prst="SECRETPRESET"/>')],
    [
      'lightRig rig',
      SPPR('<a:scene3d><a:lightRig rig="SECRETRIG"/></a:scene3d>'),
    ],
    [
      'prstClr val',
      SPPR('<a:solidFill><a:prstClr val="SECRETCLR"/></a:solidFill>'),
    ],
    [
      'sysClr val',
      SPPR('<a:solidFill><a:sysClr val="SECRETSYS"/></a:solidFill>'),
    ],
    [
      'pattFill prst',
      SPPR(
        '<a:pattFill prst="SECRETPAT"><a:fgClr><a:srgbClr val="FF0000"/></a:fgClr></a:pattFill>',
      ),
    ],
    [
      'camera prst',
      SPPR('<a:scene3d><a:camera prst="SECRETCAM"/></a:scene3d>'),
    ],
    [
      'prstTxWarp',
      SPPR('<a:txBody><a:bodyPr prstTxWarp="SECRETWARP"/></a:txBody>'),
    ],
    ['sp3d prstMaterial', SPPR('<a:sp3d prstMaterial="SECRETMAT"/>')],
  ])('%s outside its bound refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'prstGeom keeps a preset',
      SPPR('<a:prstGeom prst="rect"/>'),
      'prst="rect"',
    ],
    [
      'prstClr keeps a named colour',
      SPPR('<a:solidFill><a:prstClr val="blue"/></a:solidFill>'),
      'val="blue"',
    ],
    [
      'lightRig keeps a rig',
      SPPR('<a:scene3d><a:lightRig rig="threePt" dir="t"/></a:scene3d>'),
      'rig="threePt"',
    ],
  ])('%s', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})

describe('share-safe r6: explicit invisibility', () => {
  it.each([
    [
      'alpha val zero',
      SPPR(
        '<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="0"/></a:srgbClr></a:solidFill>',
      ),
    ],
    [
      'alphaModFix amt zero',
      SPPR(
        '<a:solidFill><a:srgbClr val="FF0000"><a:alphaModFix amt="0"/></a:srgbClr></a:solidFill>',
      ),
    ],
    [
      'alphaMod val zero',
      SPPR(
        '<a:solidFill><a:srgbClr val="FF0000"><a:alphaMod val="0"/></a:srgbClr></a:solidFill>',
      ),
    ],
    [
      'alphaOff erasing the parent alpha',
      SPPR(
        '<a:solidFill><a:srgbClr val="FF0000"><a:alphaOff val="100000"/></a:srgbClr></a:solidFill>',
      ),
    ],
    [
      'bwMode hidden',
      DRAW(
        '<pic:nvPicPr><pic:cNvPr id="1" bwMode="hidden"/><pic:cNvPicPr/></pic:nvPicPr>',
      ),
    ],
    [
      'an OMML phantom wrapper',
      OML('<m:phant><m:e><m:r><m:t>x</m:t></m:r></m:e></m:phant>'),
    ],
    [
      'a:noFill erasing drawing-run text',
      SPPR(
        '<a:txBody><a:bodyPr/><a:p><a:r><a:rPr><a:noFill/></a:rPr><a:t>SECRETHIDDEN</a:t></a:r></a:p></a:txBody>',
      ),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it('a partial alpha keeps', async () => {
    const { parts } = await outputParts({
      body: SPPR(
        '<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="50000"/></a:srgbClr></a:solidFill>',
      ),
    })
    expect(parts.get('word/document.xml')).toContain('a:alpha val="50000"')
  })
})

describe('share-safe r6: custom-property marking values', () => {
  it.each([
    [
      'an unknown documentKind',
      marking('obiter.documentKind', 'lpwstr', 'SECRETPAYLOADKIND'),
    ],
    ['a numeric draft flag', marking('obiter.draft', 'bool', '1')],
    [
      'a textual draft flag',
      marking('obiter.privileged', 'bool', 'SECRETPRIV'),
    ],
    ['a string-typed draft flag', marking('obiter.draft', 'lpwstr', 'true')],
  ])('%s refuses the copy', async (_label, propertyXml) => {
    await expectRefusal(customProperties(propertyXml))
  })

  it.each([
    [
      'a known documentKind',
      marking('obiter.documentKind', 'lpwstr', 'letter'),
      'letter',
    ],
    ['a true draft flag', marking('obiter.draft', 'bool', 'true'), '>true<'],
    [
      'a false privileged flag',
      marking('obiter.privileged', 'bool', 'false'),
      '>false<',
    ],
  ])('%s ships canonically', async (_label, propertyXml, emitted) => {
    const { parts } = await outputParts(customProperties(propertyXml))
    expect(parts.get('docProps/custom.xml')).toContain(emitted)
  })
})

describe('share-safe r6: byte-level value mirror', () => {
  const part: SourcePart = {
    name: 'word/document.xml',
    kind: 'xml',
    role: 'story',
    originalPayload: new Uint8Array(),
    dirty: false,
    trackedChanges: [],
  }
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:m="${M}" xmlns:wp="${WP}" xmlns:pic="${PIC}"><w:body>${body}</w:body></w:document>`
  const refuse = (source: string) => () => checkShareSafeXmlBytes(part, source)

  it.each([
    [
      'an out-of-enumeration w:val spliced into emitted bytes',
      xml('<w:p><w:pPr><w:jc w:val="SECRETJC"/></w:pPr></w:p>'),
    ],
    [
      'an out-of-bound w:w spliced into emitted bytes',
      xml('<w:p><w:pPr/><w:sectPr><w:pgSz w:w="SECRETW"/></w:sectPr></w:p>'),
    ],
    [
      'an out-of-bound m:val spliced into emitted bytes',
      xml(
        '<w:p><m:oMath><m:nary><m:naryPr><m:chr m:val="SECRETNARY"/></m:naryPr></m:nary></m:oMath></w:p>',
      ),
    ],
    [
      'an out-of-bound m:val flag spliced into emitted bytes',
      xml(
        '<w:p><m:oMath><m:sSub><m:sSubPr><m:subHide m:val="SECRET"/></m:sSubPr></m:sSub></m:oMath></w:p>',
      ),
    ],
    [
      'an invalid preset spliced into emitted bytes',
      xml(DRAW('<pic:spPr><a:prstGeom prst="SECRET"/></pic:spPr>')),
    ],
    [
      'a zero alpha spliced into emitted bytes',
      xml(
        SPPR(
          '<a:solidFill><a:srgbClr val="FF0000"><a:alpha val="0"/></a:srgbClr></a:solidFill>',
        ),
      ),
    ],
    [
      'an unknown extension URI spliced into emitted bytes',
      xml(SPPR('<a:extLst><a:ext uri="https://secret.invalid/x"/></a:extLst>')),
    ],
    [
      'a hidden bwMode spliced into emitted bytes',
      xml(
        DRAW('<pic:nvPicPr><pic:cNvPr id="1" bwMode="hidden"/></pic:nvPicPr>'),
      ),
    ],
  ])('%s refuses', async (_label, source) => {
    expect(refuse(source)).toThrow()
  })

  it('a declared value inside its bound verifies', () => {
    expect(
      refuse(xml('<w:p><w:pPr><w:jc w:val="both"/></w:pPr></w:p>')),
    ).not.toThrow()
  })
})
