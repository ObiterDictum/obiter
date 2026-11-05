import { describe, expect, it } from 'bun:test'
import { DEFAULT_TAB_STOP_PX, tabAdvancePx } from './document-page-tabs'
import { paragraphFace } from './document-page-style'
import type { DocumentParagraphWire } from '@obiter/contracts'

function paragraphWithXml(
  xml: string,
  styleId?: string,
): DocumentParagraphWire {
  return {
    id: 'p1',
    ...(styleId ? { styleId } : {}),
    runs: [{ id: 'p1-r', text: 'a\tb', preservedXmlFragments: [] }],
    preservedXmlFragments: [xml],
  }
}

describe('tab stops', () => {
  it('advances a tab to the next default stop', () => {
    expect(DEFAULT_TAB_STOP_PX).toBe(48)
    expect(tabAdvancePx(0, [], DEFAULT_TAB_STOP_PX)).toBe(48)
    expect(tabAdvancePx(10, [], DEFAULT_TAB_STOP_PX)).toBe(38)
    expect(tabAdvancePx(47, [], DEFAULT_TAB_STOP_PX)).toBe(1)
  })

  it('advances a tab to the next stop set on the paragraph', () => {
    const face = paragraphFace(
      paragraphWithXml(
        '<w:pPr><w:tabs><w:tab w:val="left" w:pos="1440"/></w:tabs></w:pPr>',
      ),
      [],
    )
    expect(face.tabStopsPx).toEqual([96])
    expect(tabAdvancePx(10, face.tabStopsPx ?? [], DEFAULT_TAB_STOP_PX)).toBe(
      86,
    )
  })

  it('reads tab stops from the paragraph style when the paragraph sets none', () => {
    const face = paragraphFace(paragraphWithXml('', 'ListParagraph'), [
      {
        styleId: 'ListParagraph',
        sourceFragment:
          '<w:style w:type="paragraph"><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="left" w:pos="2160"/></w:tabs></w:pPr></w:style>',
      },
    ])
    expect(face.tabStopsPx).toEqual([48, 144])
  })

  it('advances past a stop the line has already reached', () => {
    expect(tabAdvancePx(100, [96], DEFAULT_TAB_STOP_PX)).toBe(44)
    expect(tabAdvancePx(96, [96], DEFAULT_TAB_STOP_PX)).toBe(48)
  })

  it('uses the default tab stop from the document settings when one is set', () => {
    const face = paragraphFace(paragraphWithXml(''), [], 360)
    expect(face.tabStopsPx).toBeUndefined()
    expect(face.tabStopPx).toBe(24)
    expect(tabAdvancePx(6, face.tabStopsPx ?? [], face.tabStopPx ?? 0)).toBe(18)
  })
})
