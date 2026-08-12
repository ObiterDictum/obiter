import { describe, expect, it } from 'vitest'
import { drawingAnchor, drawingScene } from './document-page-drawings'

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
    ).toEqual({ leftPx: 0, topPx: -29 })
  })

  it('ignores inline drawings', () => {
    expect(
      drawingAnchor(
        '<w:drawing><wp:inline><wp:extent cx="100" cy="100"/></wp:inline></w:drawing>',
      ),
    ).toBeUndefined()
  })
})
