import { describe, expect, it } from 'bun:test'
import {
  drawingAnchor,
  drawingScene,
  type DrawingScene,
} from './document-page-drawings'

const group = `<w:drawing><wpg:wgp><a:xfrm><a:off x="0" y="0"/><a:ext cx="9129802" cy="1314450"/></a:xfrm><wps:wsp><wps:spPr><a:xfrm><a:off x="0" y="276045"/><a:ext cx="1238250" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><wps:wsp><wps:spPr><a:xfrm><a:off x="3062377" y="276045"/><a:ext cx="6067425" cy="704850"/></a:xfrm><a:solidFill><a:schemeClr val="tx2"/></a:solidFill></wps:spPr></wps:wsp><pic:pic><a:blip r:embed="rId1"/><a:xfrm><a:off x="1371600" y="0"/><a:ext cx="1454785" cy="1314450"/></a:xfrm></pic:pic></wpg:wgp><v:rect fillcolor="#212934 [1615]"/></w:drawing>`

describe('drawingScene', () => {
  it('splits a letterhead group into navy bars and a logo box', () => {
    const scene = drawingScene(group)
    expect(scene.widthPx).toBe(959)
    expect(scene.heightPx).toBe(138)
    expect(scene.parts.map((part) => part.kind)).toEqual([
      'rect',
      'rect',
      'picture',
    ])
    expect(scene.parts[0]).toMatchObject({
      kind: 'rect',
      leftPx: 0,
      fill: '#212934',
    })
    expect(scene.parts[2]).toMatchObject({
      kind: 'picture',
      leftPx: 144,
      widthPx: 153,
      heightPx: 138,
    })
  })
})

describe('drawingAnchor', () => {
  it('reads a Word drawing anchor offset in EMU', () => {
    expect(
      drawingAnchor(
        '<w:drawing><wp:anchor><wp:positionH relativeFrom="page"><wp:align>left</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>-280035</wp:posOffset></wp:positionV></wp:anchor></w:drawing>',
      ),
    ).toEqual({ leftPx: 0, topPx: -29, relativeFromV: 'paragraph' })
  })

  it('ignores inline drawings', () => {
    expect(
      drawingAnchor(
        '<w:drawing><wp:inline><wp:extent cx="100" cy="100"/></wp:inline></w:drawing>',
      ),
    ).toBeUndefined()
  })
})

/**
 * The old extent regexes used `[^>]*` on either side of two required
 * attributes, which backtracks polynomially when one attribute repeats and its
 * partner is missing. A bounded wall clock is the regression assertion: the
 * linear rewrite is sub-millisecond on these inputs.
 */
describe('drawingScene regex bounds', () => {
  const repeatedX = 'x="0" '.repeat(20_000)
  const repeatedCx = 'cx="0" '.repeat(20_000)

  function parseWithinBudget(fn: () => DrawingScene): DrawingScene {
    const start = performance.now()
    const scene = fn()
    expect(performance.now() - start).toBeLessThan(1000)
    return scene
  }

  it('reads a repeated <a:off> x with no y without backtracking', () => {
    const scene = parseWithinBudget(() =>
      drawingScene(
        `<w:drawing><a:xfrm><a:off ${repeatedX}/><a:ext cx="914400" cy="914400"/></a:xfrm><a:solidFill><a:srgbClr val="111111"/></a:solidFill></w:drawing>`,
      ),
    )
    expect(scene.widthPx).toBe(96)
    expect(scene.heightPx).toBe(96)
  })

  it('falls back when a repeated <a:ext> cx has no cy', () => {
    const scene = parseWithinBudget(() =>
      drawingScene(
        `<w:drawing><a:xfrm><a:ext ${repeatedCx}/></a:xfrm></w:drawing>`,
      ),
    )
    expect(scene).toEqual({ widthPx: 180, heightPx: 48, parts: [] })
  })

  it('falls back when a repeated <wp:extent> cx has no cy', () => {
    const scene = parseWithinBudget(() =>
      drawingScene(`<w:drawing><wp:extent ${repeatedCx}/></w:drawing>`),
    )
    expect(scene).toEqual({ widthPx: 180, heightPx: 48, parts: [] })
  })
})
