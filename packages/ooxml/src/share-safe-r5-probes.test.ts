import { describe, expect, it } from 'bun:test'

import type { SourcePart } from './model'
import { checkShareSafeXmlBytes } from './share-safe-bytecheck'
import { ShareSafeRefusal } from './share-safe-refusal'
import {
  A,
  expectClean,
  expectRefusal,
  outputParts,
  PIC,
  R,
  W,
  WP,
} from './share-safe-probe-kit'

/**
 * A minimal drawing carrier — `pic:pic` inside `wp:inline` — the bounded
 * embedded attribute vocabulary resolves inside it. The pipeline checks
 * names and values, not schema parenting, so the fragments only need to
 * place the attribute under test on a kept element.
 */
const DRAW = (inner: string) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">${inner}</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`

const BLIPFILL = (inner: string) =>
  DRAW(`<pic:blipFill>${inner}</pic:blipFill>`)
const SPPR = (inner: string) => DRAW(`<pic:spPr>${inner}</pic:spPr>`)
const TXBODY = (inner: string) =>
  DRAW(
    `<pic:spPr><a:txBody><a:bodyPr/><a:p>${inner}</a:p></a:txBody></pic:spPr>`,
  )

describe('share-safe r5: embedded attribute channels', () => {
  it.each([
    ['name on a:blip', BLIPFILL('<a:blip name="SECRETNAME"/>')],
    ['descr on a:blip', BLIPFILL('<a:blip descr="SECRETDESCR"/>')],
    [
      'title on pic:spPr',
      SPPR('').replace('<pic:spPr>', '<pic:spPr title="SECRETTITLE">'),
    ],
    [
      'id on pic:pic',
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}" id="SECRETID"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    ['fmla on a:xfrm', SPPR('<a:xfrm fmla="SECRETFMLA"/>')],
    ['typeface on a:blip', BLIPFILL('<a:blip typeface="SECRETFONT"/>')],
    [
      'script on a:latin',
      SPPR(
        '<a:solidFill><a:srgbClr val="FF0000"/><a:latin script="SECRET"/></a:solidFill>',
      ),
    ],
    [
      'lastClr on a:srgbClr',
      SPPR(
        '<a:solidFill><a:srgbClr val="FF0000" lastClr="SECRET"/></a:solidFill>',
      ),
    ],
    ['lang on a:xfrm', SPPR('<a:xfrm lang="SECRETLANG"/>')],
    ['char on a:rPr', TXBODY('<a:r><a:rPr char="SECRET"/><a:t>x</a:t></a:r>')],
    ['edited on a:blip', BLIPFILL('<a:blip edited="SECRET"/>')],
    ['panose on a:blip', BLIPFILL('<a:blip panose="SECRET"/>')],
    ['bwMode on a:blip', BLIPFILL('<a:blip bwMode="SECRET"/>')],
    [
      'wrapText on a:bodyPr',
      SPPR('<a:txBody><a:bodyPr wrapText="SECRET"/></a:txBody>'),
    ],
    ['uri on a:blip', BLIPFILL('<a:blip uri="SECRETURI"/>')],
    [
      'uri on a:ext naming a foreign host',
      SPPR('<a:extLst><a:ext uri="https://secret.invalid/x"/></a:extLst>'),
    ],
    [
      'hidden="0" leaves the flag but no payload',
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:docPr id="1" name="SECRETNAME" hidden="SECRET"/></wp:inline></w:drawing></w:r></w:p>`,
    ],
  ])('%s does not ship', async (_label, body) => {
    await expectClean({ body }, ['SECRET'])
  })

  it('name on wp:docPr strips while the bounded id keeps', async () => {
    const { parts } = await outputParts({
      body: `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:docPr id="4" name="SECRETNAME"/></wp:inline></w:drawing></w:r></w:p>`,
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('id="4"')
    expect(story).not.toContain('SECRETNAME')
    expect(story).not.toContain('name=')
  })

  it.each([
    [
      'val on a:schemeClr',
      SPPR('<a:solidFill><a:schemeClr val="SECRET"/></a:solidFill>'),
    ],
    [
      'val on a:srgbClr',
      SPPR('<a:solidFill><a:srgbClr val="GGGGGG"/></a:solidFill>'),
    ],
    [
      'id on a:cNvPr',
      DRAW('<pic:nvPicPr><pic:cNvPr id="SECRET" name="x"/></pic:nvPicPr>'),
    ],
    [
      'fmla on a:gd with a non-grammar value',
      SPPR(
        '<a:prstGeom prst="rect"><a:avLst><a:gd name="adj" fmla="SE;CRET"/></a:avLst></a:prstGeom>',
      ),
    ],
    [
      'fmla on a:gd with an entity-encoded quote',
      SPPR(
        '<a:prstGeom prst="rect"><a:avLst><a:gd name="adj" fmla="SE&quot;CRET"/></a:avLst></a:prstGeom>',
      ),
    ],
    ['cstate on a:blip', BLIPFILL('<a:blip cstate="SECRET"/>')],
    [
      'bwMode on a:cNvPr',
      DRAW('<pic:nvPicPr><pic:cNvPr id="1" bwMode="SECRET"/></pic:nvPicPr>'),
    ],
    [
      'relativeFrom on wp:positionH',
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:positionH relativeFrom="SECRET"/></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'lang on a:rPr',
      TXBODY('<a:r><a:rPr lang="SECRET-TOKEN"/><a:t>x</a:t></a:r>'),
    ],
    [
      'altLang on a:rPr',
      TXBODY('<a:r><a:rPr altLang="SECRET-TOKEN"/><a:t>x</a:t></a:r>'),
    ],
    ['u on a:rPr', TXBODY('<a:r><a:rPr u="SECRET"/><a:t>x</a:t></a:r>')],
    ['b on a:rPr', TXBODY('<a:r><a:rPr b="SECRET"/><a:t>x</a:t></a:r>')],
    [
      'type on a:buAutoNum',
      TXBODY('<a:pPr><a:buAutoNum type="SECRET"/></a:pPr>'),
    ],
    [
      'id on a:fld',
      TXBODY('<a:fld id="SECRET" type="slidenum"><a:t>1</a:t></a:fld>'),
    ],
    [
      'hidden on wp:docPr',
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:docPr id="1" hidden="1"/></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'ver on wp:docPr',
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><wp:docPr id="1" ver="SECRET"/></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'uri on a:graphicData naming a foreign payload',
      `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="urn:SECRET"/></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'xml:space carrying a payload on w:t',
      '<w:p><w:r><w:t xml:space="SECRET">x</w:t></w:r></w:p>',
    ],
    [
      'xml:space carrying a lookalike value on w:t',
      '<w:p><w:r><w:t xml:space="preservex">x</w:t></w:r></w:p>',
    ],
    [
      'xml:space carrying a payload on a:t',
      SPPR(
        '<a:txBody><a:bodyPr/><a:p><a:r><a:t xml:space="SECRET">x</a:t></a:r></a:p></a:txBody>',
      ),
    ],
  ])('%s refuses', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'xml:lang on w:t',
      '<w:p><w:r><w:t xml:lang="SECRET-TOKEN">x</w:t></w:r></w:p>',
    ],
    ['xml:base on w:t', '<w:p><w:r><w:t xml:base="SECRET">x</w:t></w:r></w:p>'],
  ])('%s strips, it never ships', async (_label, body) => {
    const { parts } = await outputParts({ body })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).not.toContain('SECRET')
    expect(story).not.toContain('xml:lang')
    expect(story).not.toContain('xml:base')
    expect(story).toContain('>x<')
  })

  it.each([
    [
      'a scheme colour keeps its enum value',
      SPPR('<a:solidFill><a:schemeClr val="accent1"/></a:solidFill>'),
      'val="accent1"',
    ],
    [
      'an sRGB colour keeps its hex value',
      SPPR('<a:solidFill><a:srgbClr val="FF00AA"/></a:solidFill>'),
      'val="FF00AA"',
    ],
    [
      'a guide keeps its bounded name and formula',
      SPPR(
        '<a:prstGeom prst="rect"><a:avLst><a:gd name="adj1" fmla="val 50000"/></a:avLst></a:prstGeom>',
      ),
      'fmla="val 50000"',
    ],
    [
      'a conditional guide formula keeps its ternary',
      SPPR(
        '<a:prstGeom prst="rect"><a:avLst><a:gd name="x" fmla="?: adj 0 w"/></a:avLst></a:prstGeom>',
      ),
      'fmla="?: adj 0 w"',
    ],
    [
      'a list numbering scheme keeps its enum value',
      TXBODY('<a:pPr><a:buAutoNum type="arabicPeriod"/></a:pPr>'),
      'type="arabicPeriod"',
    ],
    [
      'a language tag keeps on a drawing run',
      TXBODY('<a:r><a:rPr lang="en-US"/><a:t>x</a:t></a:r>'),
      'lang="en-US"',
    ],
    [
      'a font face keeps its name',
      SPPR('<a:solidFill><a:latin typeface="Calibri"/></a:solidFill>'),
      'typeface="Calibri"',
    ],
    [
      'an extension keeps a bounded URI',
      SPPR(
        '<a:extLst><a:ext uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"/></a:extLst>',
      ),
      'uri="{C183D7F6-B498-43B3-948B-1728B52AA6E4}"',
    ],
    [
      'a blip compression state keeps its enum value',
      BLIPFILL('<a:blip cstate="print"/>'),
      'cstate="print"',
    ],
    [
      'a field keeps its GUID and type',
      TXBODY(
        '<a:fld id="{1D8BD707-D9CF-40AE-B4A6-C98DA3205C09}" type="slidenum"><a:t>1</a:t></a:fld>',
      ),
      'id="{1D8BD707-D9CF-40AE-B4A6-C98DA3205C09}"',
    ],
    [
      'a paragraph alignment keeps its enum value',
      TXBODY('<a:pPr algn="ctr"><a:r><a:t>x</a:t></a:r></a:pPr>'),
      'algn="ctr"',
    ],
  ])('%s', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})

describe('share-safe r5: byte-level attribute mirror', () => {
  const part: SourcePart = {
    name: 'word/document.xml',
    kind: 'xml',
    role: 'story',
    originalPayload: new Uint8Array(),
    dirty: false,
    trackedChanges: [],
  }
  const xml = (body: string) =>
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${W}" xmlns:r="${R}" xmlns:a="${A}" xmlns:wp="${WP}" xmlns:pic="${PIC}"><w:body>${body}</w:body></w:document>`
  const refuse = (source: string) => () => checkShareSafeXmlBytes(part, source)

  it.each([
    [
      'name on a:blip in emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:blipFill><a:blip name="SECRET"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'val on a:schemeClr in emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:spPr><a:solidFill><a:schemeClr val="SECRET"/></a:solidFill></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'id on pic:pic in emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="${PIC}"><pic:pic id="SECRET"/></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'fmla on a:xfrm in emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:spPr><a:xfrm fmla="SECRET"/></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'xml:lang on w:t in emitted bytes',
      '<w:p><w:r><w:t xml:lang="SECRET-TOKEN">x</w:t></w:r></w:p>',
    ],
    [
      'xml:space with a payload on w:t in emitted bytes',
      '<w:p><w:r><w:t xml:space="SECRET">x</w:t></w:r></w:p>',
    ],
    [
      'unqualified attribute on a w: element in emitted bytes',
      '<w:p foo="SECRET"><w:r><w:t>x</w:t></w:r></w:p>',
    ],
    [
      'embedded-namespaced attribute in emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:blipFill><a:blip a:cstate="print"/></pic:blipFill></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'a hidden flag spliced into emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="1" hidden="1"/></wp:inline></w:drawing></w:r></w:p>`,
    ],
    [
      'a bound value failure spliced into emitted bytes',
      `<w:p><w:r><w:drawing><wp:inline><wp:docPr id="SECRET"/></wp:inline></w:drawing></w:r></w:p>`,
    ],
  ])('%s refuses', async (_label, body) => {
    expect(refuse(xml(body))).toThrow(ShareSafeRefusal)
  })

  it('passes a canonical part carrying bounded attributes', () => {
    const result = checkShareSafeXmlBytes(
      part,
      xml(
        `<w:p><w:r><w:t xml:space="preserve"> spaced </w:t></w:r><w:r><w:drawing><wp:inline><wp:docPr id="1"/><a:graphic><a:graphicData uri="${PIC}"><pic:pic><pic:spPr><a:solidFill><a:schemeClr val="accent1"/></a:solidFill></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`,
      ),
    )
    expect(result.bookmarkNames).toEqual([])
  })
})
