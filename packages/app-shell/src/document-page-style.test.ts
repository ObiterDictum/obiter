import { describe, expect, it } from 'vitest'
import { paragraphFace, runFace } from './document-page-style'

describe('paragraphFace', () => {
  it('applies Normal font, size, alignment and spacing from styles and pPr', () => {
    const face = paragraphFace(
      {
        id: 'p1',
        styleId: 'Normal',
        runs: [],
        preservedXmlFragments: [
          '<w:pPr><w:jc w:val="right"/><w:spacing w:after="200"/></w:pPr>',
        ],
      },
      [
        {
          styleId: 'Normal',
          sourceFragment:
            '<w:style w:styleId="Normal"><w:rPr><w:rFonts w:ascii="Times New Roman"/><w:sz w:val="24"/></w:rPr></w:style>',
        },
      ],
    )
    expect(face.align).toBe('right')
    expect(face.marginBottomPx).toBeCloseTo(13.333, 2)
    expect(face.run.fontFamily).toContain('Times New Roman')
    expect(face.run.fontSizePx).toBe(16)
    expect(face.widowControl).toBe(true)
    expect(face.keepNext).toBe(false)
  })

  it('maps left, centre, right and justify from w:jc', () => {
    const align = (jc: string) =>
      paragraphFace(
        {
          id: 'p1',
          runs: [],
          preservedXmlFragments: [`<w:pPr><w:jc w:val="${jc}"/></w:pPr>`],
        },
        [],
      ).align
    expect(align('left')).toBe('left')
    expect(align('start')).toBe('left')
    expect(align('center')).toBe('center')
    expect(align('right')).toBe('right')
    expect(align('end')).toBe('right')
    expect(align('both')).toBe('justify')
  })

  it('does not treat a tab stop as paragraph alignment', () => {
    const face = paragraphFace(
      {
        id: 'p1',
        runs: [],
        preservedXmlFragments: [
          '<w:pPr><w:tabs><w:tab w:val="right" w:pos="9026"/></w:tabs></w:pPr>',
        ],
      },
      [],
    )
    expect(face.align).toBeUndefined()
  })

  it('reads keep-with-next and keep-lines from pPr', () => {
    const face = paragraphFace(
      {
        id: 'p1',
        runs: [],
        preservedXmlFragments: [
          '<w:pPr><w:keepNext/><w:keepLines/></w:pPr>',
        ],
      },
      [],
    )
    expect(face.keepNext).toBe(true)
    expect(face.keepLines).toBe(true)
  })
})

describe('runFace', () => {
  it('overlays direct run bold and colour on the paragraph face', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'Re:',
        preservedXmlFragments: [
          '<w:rPr><w:b/><w:color w:val="1F4E79"/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.bold).toBe(true)
    expect(face.color).toBe('#1F4E79')
    expect(face.fontSizePx).toBeCloseTo(14.666, 2)
  })
})
