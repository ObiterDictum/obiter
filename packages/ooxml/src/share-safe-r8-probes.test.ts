import { describe, expect, it } from 'bun:test'

import { A, expectRefusal, outputParts, PIC, WP } from './share-safe-probe-kit'

/**
 * R8: alpha policy anchored to the transform's semantics, not its
 * lexical shape. `alphaOff` is additive — ECMA-376 §20.1.2.3.3: "a 10%
 * alpha offset increases a 50% opacity to 60%. A -10% alpha offset
 * decreases a 50% opacity to 40%" — so the erasing direction is
 * negative: every negative offset can complete an erasure against the
 * base it composes with and refuses, while `0` and positive offsets up
 * to `100%` keep. `alpha`/`alphaRepl` declare an absolute alpha with a
 * 1% floor, below which the colour is invisible however spelled.
 * `alphaMod`/`alphaModFix` multiply the running alpha, so multipliers
 * under 100% refuse and only non-reducing modulators keep. `alphaInv`,
 * `alphaFloor` and `alphaBiLevel` can erase their input wherever they
 * sit, so the elements refuse outright. `alphaOutset`'s signed
 * `ST_Coordinate rad` refuses its eroding negative-inset form, and the
 * required slots of `biLevel` (`thresh`), `softEdge` (`rad`) and
 * `fillOverlay` (`blend`) refuse when absent or out of enum.
 */
const DRAW = (inner: string) =>
  `<w:p><w:r><w:drawing><wp:inline xmlns:wp="${WP}"><a:graphic xmlns:a="${A}"><a:graphicData uri="${PIC}"><pic:pic xmlns:pic="${PIC}">${inner}</pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`
const SPPR = (inner: string) => DRAW(`<pic:spPr>${inner}</pic:spPr>`)
const FILL = (child: string) =>
  SPPR(
    `<a:solidFill><a:srgbClr val="FF0000">${child}</a:srgbClr></a:solidFill>`,
  )

describe('share-safe r8: alphaOff is additive', () => {
  it.each([
    ['a fully erasing offset', FILL('<a:alphaOff val="-100000"/>')],
    ['a fully erasing literal', FILL('<a:alphaOff val="-100%"/>')],
    ['a small negative offset', FILL('<a:alphaOff val="-1"/>')],
    ['a decimal negative literal', FILL('<a:alphaOff val="-0.5%"/>')],
    ['a leading-zero negative literal', FILL('<a:alphaOff val="-050%"/>')],
    [
      'a negative offset completing a partial alpha',
      FILL('<a:alpha val="50000"/><a:alphaOff val="-50%"/>'),
    ],
    [
      'a negative offset completing an opaque alpha',
      FILL('<a:alpha val="100000"/><a:alphaOff val="-99999"/>'),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    ['a zero offset', FILL('<a:alphaOff val="0"/>'), 'a:alphaOff val="0"'],
    [
      'a negative zero offset (a no-op)',
      FILL('<a:alphaOff val="-0"/>'),
      'a:alphaOff val="-0"',
    ],
    [
      'a positive offset',
      FILL('<a:alphaOff val="5%"/>'),
      'a:alphaOff val="5%"',
    ],
    [
      'a fully deepening offset',
      FILL('<a:alphaOff val="100000"/>'),
      'a:alphaOff val="100000"',
    ],
    [
      'a fully deepening literal',
      FILL('<a:alphaOff val="100%"/>'),
      'a:alphaOff val="100%"',
    ],
    [
      'a positive offset after a partial alpha',
      FILL('<a:alpha val="50000"/><a:alphaOff val="50000"/>'),
      'a:alphaOff val="50000"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})

describe('share-safe r8: declared-alpha floor', () => {
  it.each([
    ['a sub-floor alpha', FILL('<a:alpha val="999"/>')],
    ['a sub-floor alpha literal', FILL('<a:alpha val="0.9%"/>')],
    ['a negative alpha', FILL('<a:alpha val="-1"/>')],
    ['a negative zero alpha', FILL('<a:alpha val="-0"/>')],
    ['a sub-floor alphaRepl', FILL('<a:alphaRepl a="999"/>')],
    ['a sub-floor alphaRepl literal', FILL('<a:alphaRepl a="0.5%"/>')],
    ['a negative alphaRepl', FILL('<a:alphaRepl a="-1"/>')],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'a floor-boundary alpha',
      FILL('<a:alpha val="1000"/>'),
      'a:alpha val="1000"',
    ],
    [
      'a floor-boundary literal',
      FILL('<a:alpha val="1%"/>'),
      'a:alpha val="1%"',
    ],
    [
      'a leading-zero floor literal',
      FILL('<a:alpha val="01%"/>'),
      'a:alpha val="01%"',
    ],
    [
      'an ordinary partial alpha',
      FILL('<a:alpha val="50%"/>'),
      'a:alpha val="50%"',
    ],
    [
      'a floor-boundary alphaRepl',
      FILL('<a:alphaRepl a="1000"/>'),
      'a:alphaRepl a="1000"',
    ],
    [
      'a last-writer replacement above the floor',
      FILL('<a:alpha val="100000"/><a:alphaRepl a="1000"/>'),
      'a:alphaRepl a="1000"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})

describe('share-safe r8: modulators only non-reducing', () => {
  it.each([
    ['a reducing alphaMod', FILL('<a:alphaMod val="99999"/>')],
    ['a reducing alphaMod literal', FILL('<a:alphaMod val="99.999%"/>')],
    ['a halving alphaMod', FILL('<a:alphaMod val="50%"/>')],
    ['a zero alphaMod', FILL('<a:alphaMod val="0"/>')],
    ['a reducing alphaModFix', FILL('<a:alphaModFix amt="99999"/>')],
    ['a reducing alphaModFix literal', FILL('<a:alphaModFix amt="99.999%"/>')],
    [
      'a reducing modulator after a partial alpha',
      FILL('<a:alpha val="50000"/><a:alphaMod val="99999"/>'),
    ],
    [
      'repeated reductions on one chain',
      FILL(
        '<a:alphaMod val="150000"/><a:alphaMod val="50000"/><a:alphaMod val="150000"/>',
      ),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'an identity alphaMod',
      FILL('<a:alphaMod val="100000"/>'),
      'a:alphaMod val="100000"',
    ],
    [
      'an identity alphaMod literal',
      FILL('<a:alphaMod val="100%"/>'),
      'a:alphaMod val="100%"',
    ],
    [
      'an amplifying alphaMod',
      FILL('<a:alphaMod val="150%"/>'),
      'a:alphaMod val="150%"',
    ],
    [
      'an identity alphaModFix',
      FILL('<a:alphaModFix amt="100000"/>'),
      'a:alphaModFix amt="100000"',
    ],
    [
      'an amplifying alphaModFix',
      FILL('<a:alphaModFix amt="150000"/>'),
      'a:alphaModFix amt="150000"',
    ],
    [
      'a non-reducing modulator chain',
      FILL(
        '<a:alpha val="50000"/><a:alphaMod val="200000"/><a:alphaModFix amt="110%"/>',
      ),
      'a:alphaModFix amt="110%"',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})

describe('share-safe r8: alpha-erasure elements and effect siblings', () => {
  it.each([
    ['an alphaInv in a fill', FILL('<a:alphaInv/>')],
    ['an alphaFloor in a fill', FILL('<a:alphaFloor/>')],
    ['an alphaBiLevel in a fill', FILL('<a:alphaBiLevel thresh="50000"/>')],
    [
      'an alphaBiLevel erasing everything below opaque',
      FILL('<a:alphaBiLevel thresh="100000"/>'),
    ],
    [
      'an alphaFloor after a near-opaque alpha',
      FILL('<a:alpha val="99999"/><a:alphaFloor/>'),
    ],
    [
      'an alphaInv carrying a colour child',
      FILL('<a:alphaInv><a:srgbClr val="00FF00"/></a:alphaInv>'),
    ],
    [
      'an alphaOutset eroding the shape',
      SPPR('<a:effectLst><a:alphaOutset rad="-1000000"/></a:effectLst>'),
    ],
    [
      'an alphaOutset inset of one EMU',
      SPPR('<a:effectLst><a:alphaOutset rad="-1"/></a:effectLst>'),
    ],
    [
      'a biLevel missing thresh',
      SPPR('<a:effectLst><a:biLevel/></a:effectLst>'),
    ],
    [
      'a biLevel thresh out of range',
      SPPR('<a:effectLst><a:biLevel thresh="100001"/></a:effectLst>'),
    ],
    [
      'a signed biLevel thresh',
      SPPR('<a:effectLst><a:biLevel thresh="-1"/></a:effectLst>'),
    ],
    [
      'a softEdge missing rad',
      SPPR('<a:effectLst><a:softEdge/></a:effectLst>'),
    ],
    [
      'a signed softEdge rad',
      SPPR('<a:effectLst><a:softEdge rad="-1"/></a:effectLst>'),
    ],
    [
      'a fillOverlay missing blend',
      SPPR(
        '<a:effectLst><a:fillOverlay><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:fillOverlay></a:effectLst>',
      ),
    ],
    [
      'a fillOverlay blend outside the enum',
      SPPR(
        '<a:effectLst><a:fillOverlay blend="dstOut"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:fillOverlay></a:effectLst>',
      ),
    ],
    [
      'a glow with a signed rad',
      SPPR(
        '<a:effectLst><a:glow rad="-1"><a:srgbClr val="FF0000"/></a:glow></a:effectLst>',
      ),
    ],
    [
      'a blur with a signed rad',
      SPPR('<a:effectLst><a:blur rad="-1"/></a:effectLst>'),
    ],
  ])('%s refuses the copy', async (_label, body) => {
    await expectRefusal({ body })
  })

  it.each([
    [
      'an alphaCeiling in a fill',
      FILL('<a:alphaCeiling/>'),
      '<a:alphaCeiling/>',
    ],
    [
      'an alphaOutset bare (rad defaults to zero, inert)',
      SPPR('<a:effectLst><a:alphaOutset/></a:effectLst>'),
      '<a:alphaOutset/>',
    ],
    [
      'an alphaOutset growing the mask',
      SPPR('<a:effectLst><a:alphaOutset rad="1000"/></a:effectLst>'),
      '<a:alphaOutset rad="1000"/>',
    ],
    [
      'a biLevel threshold',
      SPPR('<a:effectLst><a:biLevel thresh="50000"/></a:effectLst>'),
      '<a:biLevel thresh="50000"/>',
    ],
    [
      'a softEdge radius',
      SPPR('<a:effectLst><a:softEdge rad="40000"/></a:effectLst>'),
      '<a:softEdge rad="40000"/>',
    ],
    [
      'a fillOverlay over blend',
      SPPR(
        '<a:effectLst><a:fillOverlay blend="over"><a:solidFill><a:srgbClr val="FF0000"/></a:solidFill></a:fillOverlay></a:effectLst>',
      ),
      '<a:fillOverlay blend="over">',
    ],
    [
      'a glow radius',
      SPPR(
        '<a:effectLst><a:glow rad="40000"><a:srgbClr val="FF0000"/></a:glow></a:effectLst>',
      ),
      '<a:glow rad="40000">',
    ],
    [
      'a blur radius',
      SPPR('<a:effectLst><a:blur rad="40000"/></a:effectLst>'),
      '<a:blur rad="40000"/>',
    ],
  ])('%s ships', async (_label, body, emitted) => {
    const { parts } = await outputParts({ body })
    expect(parts.get('word/document.xml')).toContain(emitted)
  })
})
