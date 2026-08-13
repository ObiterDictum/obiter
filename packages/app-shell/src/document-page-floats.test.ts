import { describe, expect, it } from 'vitest'
import {
  drawingFloat,
  lineInset,
  textBoxParagraphIds,
  wrapKind,
} from './document-page-floats'

const square =
  '<w:drawing><wp:anchor distT="0" distB="0" distL="114300" distR="114300" behindDoc="0"><wp:positionH relativeFrom="margin"><wp:align>right</wp:align></wp:positionH><wp:positionV relativeFrom="paragraph"><wp:posOffset>0</wp:posOffset></wp:positionV><wp:wrapSquare/></wp:anchor></w:drawing>'

describe('wrapKind', () => {
  it('maps Word wrap elements, treating tight as square', () => {
    expect(wrapKind('<wp:wrapNone/>')).toBe('none')
    expect(wrapKind('<wp:wrapTopAndBottom/>')).toBe('topAndBottom')
    expect(wrapKind('<wp:wrapTight/>')).toBe('square')
    expect(wrapKind(square)).toBe('square')
  })
})

describe('drawingFloat', () => {
  it('reads wrap, alignment, and distances from a Word anchor', () => {
    const spec = drawingFloat(square, 'p1')
    expect(spec?.wrap).toBe('square')
    expect(spec?.alignH).toBe('right')
    expect(spec?.relativeFromH).toBe('margin')
    expect(spec?.dist.left).toBe(12)
  })
})

describe('textBoxParagraphIds', () => {
  it('keeps Choice paraIds and drops Fallback copies', () => {
    expect(
      textBoxParagraphIds(
        '<mc:Choice><w:txbxContent><w:p w14:paraId="AAAA"/></w:txbxContent></mc:Choice><mc:Fallback><w:txbxContent><w:p w14:paraId="AAAA"/></w:txbxContent></mc:Fallback>',
      ),
    ).toEqual(['para-w14-AAAA'])
  })
})

describe('lineInset', () => {
  const frame = {
    top: 96,
    right: 96,
    bottom: 96,
    left: 96,
    widthPx: 600,
    heightPx: 800,
  }
  const column = { left: 0, widthPx: 600 }

  it('insets the wider remaining side for square wrap', () => {
    const inset = lineInset(120, 16, column, frame, [
      {
        xml: square,
        leftPx: 496,
        topPx: 96,
        widthPx: 200,
        heightPx: 200,
        wrap: 'square',
        behind: false,
        dist: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    ])
    expect(inset.padRightPx).toBeGreaterThan(0)
    expect(inset.skipTo).toBeUndefined()
  })

  it('skips the float band for top-and-bottom wrap', () => {
    const inset = lineInset(120, 16, column, frame, [
      {
        xml: square,
        leftPx: 96,
        topPx: 96,
        widthPx: 200,
        heightPx: 200,
        wrap: 'topAndBottom',
        behind: false,
        dist: { top: 0, right: 0, bottom: 0, left: 0 },
      },
    ])
    expect(inset.skipTo).toBe(200)
  })
})
