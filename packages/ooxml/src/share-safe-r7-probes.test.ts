import { describe, expect, it } from 'bun:test'

import { A, expectRefusal, outputParts, PIC, WP } from './share-safe-probe-kit'

/**
 * R7: the schema itself, not a plausibility guess. The alpha family's
 * percentage slots carry the union the type declares (thousandths int or
 * `N%` literal) with the sign and range the same type permits, required
 * attributes must be present, the OMML `m:val` enumeration tables match
 * `shared-math.xsd` token for token, and package declarations carry only
 * their declared grammar. Every bound the transform applies is
 * re-derived at byte level — a writer splice faces the same refusal.
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

describe('share-safe r7: alpha family lexical forms', () => {
  it.each([
    ['a signed alpha', FILL('<a:alpha val="-5"/>')],
    ['a percent-literal zero alpha', FILL('<a:alpha val="0%"/>')],
    ['a decimal-percent zero alpha', FILL('<a:alpha val="0.00%"/>')],
    ['an alpha above its fixed range', FILL('<a:alpha val="101%"/>')],
    ['an alpha above its int range', FILL('<a:alpha val="100001"/>')],
    ['a missing required alpha val', FILL('<a:alpha/>')],
    [
      'a signed alphaOff outside its signed range',
      FILL('<a:alphaOff val="-100001"/>'),
    ],
    [
      'an alphaOff fully erasing alpha as a literal (the offset is additive)',
      FILL('<a:alphaOff val="-100%"/>'),
    ],
    ['a negative alphaOff inside range', FILL('<a:alphaOff val="-5%"/>')],
    ['a negative alphaOff int', FILL('<a:alphaOff val="-1"/>')],
    ['a signed alphaMod', FILL('<a:alphaMod val="-5"/>')],
    ['a reducing alphaMod', FILL('<a:alphaMod val="99999"/>')],
    ['a reducing alphaMod literal', FILL('<a:alphaMod val="50%"/>')],
    ['a signed alphaModFix amt', FILL('<a:alphaModFix amt="-10"/>')],
    ['a zero alphaModFix amt literal', FILL('<a:alphaModFix amt="0%"/>')],
    ['a reducing alphaModFix amt', FILL('<a:alphaModFix amt="50000"/>')],
    ['a reducing alphaModFix literal', FILL('<a:alphaModFix amt="75%"/>')],
    ['a zero alphaRepl', FILL('<a:alphaRepl a="0"/>')],
    ['an alphaRepl missing its required a', FILL('<a:alphaRepl/>')],
    [
      'an alphaRepl carrying the wrong slot',
      FILL('<a:alphaRepl val="50000"/>'),
    ],
    ['an alphaRepl out of its fixed range', FILL('<a:alphaRepl a="101%"/>')],
    ['an invented alphaBi element', FILL('<a:alphaBi thresh="50000"/>')],
    ['an alphaBiLevel missing its required thresh', FILL('<a:alphaBiLevel/>')],
    [
      'an alphaBiLevel thresh outside its range',
      FILL('<a:alphaBiLevel thresh="101%"/>'),
    ],
    [
      'an alphaBiLevel with a signed thresh',
      FILL('<a:alphaBiLevel thresh="-1"/>'),
    ],
    ['an alphaModFix amt with text', FILL('<a:alphaModFix amt="SECRETAMT"/>')],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    ['an int alpha', FILL('<a:alpha val="50000"/>'), 'a:alpha val="50000"'],
    [
      'a percent-literal alpha',
      FILL('<a:alpha val="50%"/>'),
      'a:alpha val="50%"',
    ],
    [
      'a decimal-percent alpha',
      FILL('<a:alpha val="50.5%"/>'),
      'a:alpha val="50.5%"',
    ],
    [
      'a fully opaque alpha',
      FILL('<a:alpha val="100000"/>'),
      'a:alpha val="100000"',
    ],
    [
      'a positive alphaOff inside range',
      FILL('<a:alphaOff val="5%"/>'),
      'a:alphaOff val="5%"',
    ],
    [
      'a fully deepening alphaOff',
      FILL('<a:alphaOff val="100%"/>'),
      'a:alphaOff val="100%"',
    ],
    ['a zero alphaOff', FILL('<a:alphaOff val="0"/>'), 'a:alphaOff val="0"'],
    [
      'an alphaMod above 100%',
      FILL('<a:alphaMod val="150%"/>'),
      'a:alphaMod val="150%"',
    ],
    [
      'an alphaModFix at 100%',
      FILL('<a:alphaModFix amt="100%"/>'),
      'a:alphaModFix amt="100%"',
    ],
    [
      'an alphaRepl replacement alpha',
      FILL('<a:alphaRepl a="80000"/>'),
      'a:alphaRepl a="80000"',
    ],
    [
      'an alphaModFix amt int',
      FILL('<a:alphaModFix amt="150000"/>'),
      'a:alphaModFix amt="150000"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })

  it.each([
    ['an alphaBiLevel threshold', FILL('<a:alphaBiLevel thresh="50000"/>')],
    ['an alphaFloor under a fill', FILL('<a:alphaFloor/>')],
    ['an alphaInv under a fill', FILL('<a:alphaInv/>')],
    [
      'an alphaFloor inside an effect list',
      SPPR('<a:effectLst><a:alphaFloor/></a:effectLst>'),
    ],
    [
      'an alphaInv inside an effect list',
      SPPR('<a:effectLst><a:alphaInv/></a:effectLst>'),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it('alpha effect elements that cannot erase ship', async () => {
    const { parts } = await outputParts({
      body: SPPR(
        '<a:effectLst><a:alphaCeiling/><a:alphaOutset rad="1000"/></a:effectLst>',
      ),
    })
    const story = parts.get('word/document.xml') ?? ''
    expect(story).toContain('<a:alphaCeiling/>')
    expect(story).toContain('<a:alphaOutset rad="1000"/>')
  })
})

describe('share-safe r7: required attributes', () => {
  it.each([
    ['a prstGeom missing prst', SPPR('<a:prstGeom/>')],
    ['a srgbClr missing val', SPPR('<a:solidFill><a:srgbClr/></a:solidFill>')],
    ['a camera missing prst', SPPR('<a:scene3d><a:camera/></a:scene3d>')],
    [
      'a lightRig missing dir',
      SPPR('<a:scene3d><a:lightRig rig="threePt"/></a:scene3d>'),
    ],
    [
      'a gradient stop missing pos',
      SPPR('<a:gradFill><a:gsLst><a:gs/></a:gsLst></a:gradFill>'),
    ],
    [
      'a graphicData missing uri',
      DRAW('<pic:spPr/>').replace(`uri="${PIC}"`, ''),
    ],
    [
      'a cNvPr missing id',
      DRAW('<pic:nvPicPr><pic:cNvPr name="x"/><pic:cNvPicPr/></pic:nvPicPr>'),
    ],
    [
      'a gd missing fmla',
      SPPR(
        '<a:prstGeom prst="rect"><a:avLst><a:gd name="x"/></a:avLst></a:prstGeom>',
      ),
    ],
    ['an a:off missing y', SPPR('<a:xfrm><a:off x="0"/></a:xfrm>')],
    [
      'an scrgbClr missing g',
      SPPR('<a:solidFill><a:scrgbClr r="100%" b="0"/></a:solidFill>'),
    ],
    [
      'an hslClr missing lum',
      SPPR('<a:solidFill><a:hslClr hue="0" sat="50%"/></a:solidFill>'),
    ],
    [
      'an a:font missing script',
      SPPR('<a:latin typeface="Calibri"/><a:font typeface="Arial"/>'),
    ],
    [
      'a buChar missing char',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:buFont typeface="Arial"/><a:buChar/></a:pPr></a:p></a:txBody>',
      ),
    ],
    [
      'an spcPct missing val',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:spcBef><a:spcPct/></a:spcBef></a:pPr></a:p></a:txBody>',
      ),
    ],
    [
      'an spcPct above its range',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:spcBef><a:spcPct val="13200001"/></a:spcBef></a:pPr></a:p></a:txBody>',
      ),
    ],
    [
      'an spcPts above its range',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:spcAft><a:spcPts val="158401"/></a:spcAft></a:pPr></a:p></a:txBody>',
      ),
    ],
    [
      'a buSzPct below its pattern range',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:buSzPct val="10%"/></a:pPr></a:p></a:txBody>',
      ),
    ],
    [
      'a buSzPts below its range',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:buSzPts val="50"/></a:pPr></a:p></a:txBody>',
      ),
    ],
    [
      'a buSzPct missing val',
      SPPR('<a:txBody><a:p><a:pPr><a:buSzPct/></a:pPr></a:p></a:txBody>'),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'an spcPct percent literal',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:spcBef><a:spcPct val="150%"/></a:spcBef></a:pPr></a:p></a:txBody>',
      ),
      'a:spcPct val="150%"',
    ],
    [
      'an spcPct thousandths int',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:spcBef><a:spcPct val="150000"/></a:spcBef></a:pPr></a:p></a:txBody>',
      ),
      'a:spcPct val="150000"',
    ],
    [
      'an spcPts value',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:spcAft><a:spcPts val="1200"/></a:spcAft></a:pPr></a:p></a:txBody>',
      ),
      'a:spcPts val="1200"',
    ],
    [
      'a buSzPct literal inside its pattern',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:buSzPct val="300%"/></a:pPr></a:p></a:txBody>',
      ),
      'a:buSzPct val="300%"',
    ],
    [
      'a buSzPts value',
      SPPR(
        '<a:txBody><a:p><a:pPr><a:buSzPts val="900"/></a:pPr></a:p></a:txBody>',
      ),
      'a:buSzPts val="900"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })

  it('an a:ext without uri removes whole, never a required-check half-measure', async () => {
    const { parts } = await outputParts({
      body: SPPR('<a:extLst><a:ext><a:extLst/></a:ext></a:extLst>'),
    })
    expect(parts.get('word/document.xml')).not.toContain('<a:ext ')
  })
})

describe('share-safe r7: OMML bounds against shared-math.xsd', () => {
  it.each([
    [
      'm:type skewed (invented token)',
      OML('<m:f><m:fPr><m:type m:val="skewed"/></m:fPr></m:f>'),
    ],
    [
      'm:type noFrac (invented token)',
      OML('<m:f><m:fPr><m:type m:val="noFrac"/></m:fPr></m:f>'),
    ],
    [
      'm:brkBin repeat-- (invented token)',
      OML('<m:r><m:rPr><m:brkBin m:val="repeat--"/></m:rPr><m:t>x</m:t></m:r>'),
    ],
    [
      'm:vertJc center (not TopBot)',
      OML('<m:d><m:dPr><m:vertJc m:val="center"/></m:dPr></m:d>'),
    ],
    [
      'm:mcJc inline (not XAlign)',
      OML(
        '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:mcJc m:val="inline"/></m:mcPr></m:mc></m:mcs></m:mPr></m:m>',
      ),
    ],
    [
      'm:baseJc largest (not YAlign)',
      OML(
        '<m:oMathPara><m:oMathParaPr><m:baseJc m:val="largest"/></m:oMathParaPr></m:oMathPara>',
      ),
    ],
    [
      'm:maxDist carrying a number (it is on/off)',
      OML('<m:nary><m:naryPr><m:maxDist m:val="5"/></m:naryPr></m:nary>'),
    ],
    ['m:argSz outside ±2', OML('<m:argPr><m:argSz m:val="3"/></m:argPr>')],
    [
      'm:count above 255',
      OML(
        '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:count m:val="300"/></m:mcPr></m:mc></m:mcs></m:mPr></m:m>',
      ),
    ],
    [
      'm:cGpRule above 4',
      OML('<m:eqArr><m:eqArrPr><m:cGpRule m:val="9"/></m:eqArrPr></m:eqArr>'),
    ],
    [
      'm:chr holding two characters',
      OML('<m:nary><m:naryPr><m:chr m:val="ab"/></m:naryPr></m:nary>'),
    ],
    [
      'm:chr missing required m:val',
      OML('<m:nary><m:naryPr><m:chr/></m:naryPr></m:nary>'),
    ],
    [
      'm:brk alnAt above 255',
      OML('<m:r><m:rPr><m:brk m:alnAt="300"/></m:rPr><m:t>x</m:t></m:r>'),
    ],
    [
      'm:brk alnAt with text',
      OML('<m:r><m:rPr><m:brk m:alnAt="SECRET"/></m:rPr><m:t>x</m:t></m:r>'),
    ],
    ['an invented m:dist element', OML('<m:dist m:val="1"/>')],
    ['an invented m:dMacro element', OML('<m:dMacro m:val="1"/>')],
    ['an invented m:msSub element', OML('<m:msSub m:val="1"/>')],
    ['an invented m:intChk element', OML('<m:intChk m:val="1"/>')],
    [
      'm:val on m:ctrlPr (no m:val declared)',
      OML('<m:r><m:rPr><m:ctrlPr m:val="1"/></m:rPr><m:t>x</m:t></m:r>'),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'm:type skw',
      OML('<m:f><m:fPr><m:type m:val="skw"/></m:fPr></m:f>'),
      'm:type m:val="skw"',
    ],
    [
      'm:type noBar',
      OML('<m:f><m:fPr><m:type m:val="noBar"/></m:fPr></m:f>'),
      'm:type m:val="noBar"',
    ],
    [
      'm:brkBin repeat',
      OML('<m:r><m:rPr><m:brkBin m:val="repeat"/></m:rPr><m:t>x</m:t></m:r>'),
      'm:val="repeat"',
    ],
    [
      'm:vertJc bot',
      OML('<m:d><m:dPr><m:vertJc m:val="bot"/></m:dPr></m:d>'),
      'm:vertJc m:val="bot"',
    ],
    [
      'm:mcJc inside',
      OML(
        '<m:m><m:mPr><m:mcs><m:mc><m:mcPr><m:mcJc m:val="inside"/></m:mcPr></m:mc></m:mcs></m:mPr></m:m>',
      ),
      'm:val="inside"',
    ],
    [
      'm:baseJc inside',
      OML(
        '<m:oMathPara><m:oMathParaPr><m:baseJc m:val="inside"/></m:oMathParaPr></m:oMathPara>',
      ),
      'm:baseJc m:val="inside"',
    ],
    [
      'm:brk alnAt',
      OML('<m:r><m:rPr><m:brk m:alnAt="3"/></m:rPr><m:t>x</m:t></m:r>'),
      'm:alnAt="3"',
    ],
    [
      'm:diff toggle',
      OML('<m:box><m:boxPr><m:diff m:val="1"/></m:boxPr></m:box>'),
      'm:diff m:val="1"',
    ],
    [
      'm:interSp universal measure',
      OML(
        '<m:oMathPara><m:oMathParaPr><m:interSp m:val="12pt"/></m:oMathParaPr></m:oMathPara>',
      ),
      'm:interSp m:val="12pt"',
    ],
    [
      'm:interSp twips',
      OML(
        '<m:oMathPara><m:oMathParaPr><m:interSp m:val="240"/></m:oMathParaPr></m:oMathPara>',
      ),
      'm:interSp m:val="240"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})
