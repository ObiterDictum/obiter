import { describe, expect, it } from 'bun:test'
import { paragraphFace, runCss, runFace } from './document-page-style'

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
        preservedXmlFragments: ['<w:pPr><w:keepNext/><w:keepLines/></w:pPr>'],
      },
      [],
    )
    expect(face.keepNext).toBe(true)
    expect(face.keepLines).toBe(true)
  })

  it('ignores a paragraph mark that exists only inside a tracked pPrChange', () => {
    const face = paragraphFace(
      {
        id: 'p1',
        runs: [],
        preservedXmlFragments: [
          '<w:pPr><w:pPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:pPr><w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="subscript"/></w:rPr></w:pPr></w:pPrChange></w:pPr>',
        ],
      },
      [],
    )
    expect(face.run.strike).toBeUndefined()
    expect(face.run.highlight).toBeUndefined()
    expect(face.run.vertAlign).toBeUndefined()
    expect(runCss(face.run).textDecoration).toBeUndefined()
    expect(runCss(face.run).backgroundColor).toBeUndefined()
    expect(runCss(face.run).verticalAlign).toBeUndefined()
  })

  it('reads the current paragraph mark around a tracked pPrChange', () => {
    const face = paragraphFace(
      {
        id: 'p1',
        runs: [],
        preservedXmlFragments: [
          '<w:pPr><w:rPr><w:b/></w:rPr><w:pPrChange w:id="1"><w:pPr><w:rPr><w:strike/></w:rPr></w:pPr></w:pPrChange><w:jc w:val="right"/></w:pPr>',
        ],
      },
      [],
    )
    expect(face.align).toBe('right')
    expect(face.run.bold).toBe(true)
    expect(face.run.strike).toBeUndefined()
  })

  it('ignores a style pPrChange when deriving the paragraph face', () => {
    const face = paragraphFace(
      {
        id: 'p1',
        styleId: 'Heading1',
        runs: [],
        preservedXmlFragments: [],
      },
      [
        {
          styleId: 'Heading1',
          sourceFragment:
            '<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:pPr><w:pPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:pPr><w:rPr><w:strike/><w:vertAlign w:val="subscript"/></w:rPr></w:pPr></w:pPrChange></w:pPr></w:style>',
        },
      ],
    )
    expect(face.run.strike).toBeUndefined()
    expect(face.run.vertAlign).toBeUndefined()
    const run = runFace(
      { id: 'r1', text: 'x', preservedXmlFragments: [] },
      face,
      [],
    )
    expect(run.strike).toBeUndefined()
    expect(runCss(run).textDecoration).toBeUndefined()
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

  it('reads strike, highlight and vertical align from the run XML', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.strike).toBe(true)
    expect(face.highlight).toBe('#FFFF00')
    expect(face.vertAlign).toBe('superscript')
    const css = runCss(face)
    expect(css.textDecoration).toContain('line-through')
    expect(css.backgroundColor).toBe('#FFFF00')
    expect(css.verticalAlign).toBe('super')
  })

  it('renders underline and strikethrough together and clears each independently', () => {
    expect(runCss({ underline: true, strike: true }).textDecoration).toBe(
      'underline line-through',
    )
    expect(runCss({ underline: true, strike: false }).textDecoration).toBe(
      'underline',
    )
    expect(runCss({ underline: false, strike: true }).textDecoration).toBe(
      'line-through',
    )
    expect(runCss({ underline: false, strike: false }).textDecoration).toBe(
      'none',
    )
  })

  it('treats every strike off spelling as off', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    for (const value of ['0', 'false', 'off']) {
      const face = runFace(
        {
          id: 'r1',
          text: 'x',
          preservedXmlFragments: [
            `<w:rPr><w:strike w:val="${value}"/></w:rPr>`,
          ],
        },
        paragraph,
        [],
      )
      expect(face.strike).toBe(false)
      expect(runCss(face).textDecoration).toBe('none')
    }
  })

  it('ignores run properties that exist only inside a tracked rPrChange', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1" w:author="A" w:date="2026-01-01T00:00:00Z"><w:rPr><w:strike/><w:highlight w:val="yellow"/><w:vertAlign w:val="superscript"/></w:rPr></w:rPrChange></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.strike).toBeUndefined()
    expect(face.highlight).toBeUndefined()
    expect(face.vertAlign).toBeUndefined()
    expect(runCss(face).textDecoration).toBeUndefined()
    expect(runCss(face).backgroundColor).toBeUndefined()
    expect(runCss(face).verticalAlign).toBeUndefined()
  })

  it('keeps current properties after a self-closing tracked change', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1"/><w:b/><w:rPrChange w:id="2"><w:rPr><w:i/></w:rPr></w:rPrChange></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.bold).toBe(true)
    expect(face.italic).toBeUndefined()
    expect(runCss(face).fontWeight).toBe(700)
  })

  it('pairs a nested tracked change with its own close', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1"><w:rPr><w:b/><w:rPrChange w:id="2"><w:rPr><w:i/></w:rPr></w:rPrChange><w:strike/></w:rPr></w:rPrChange><w:u w:val="single"/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.underline).toBe(true)
    expect(face.strike).toBeUndefined()
    expect(face.bold).toBeUndefined()
    expect(runCss(face).textDecoration).toBe('underline')
  })

  it('drops adjacent tracked changes and keeps the flag between them', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1"><w:rPr><w:i/></w:rPr></w:rPrChange><w:b/><w:rPrChange w:id="2"/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.bold).toBe(true)
    expect(face.italic).toBeUndefined()
  })

  it('ends a change tag at its own >, not one inside an attribute value', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:rPrChange w:id="1" w:author="a>b"><w:rPr><w:strike/></w:rPr></w:rPrChange><w:i/><w:b w:note="a>b" w:val="0"/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.strike).toBeUndefined()
    expect(face.italic).toBe(true)
    expect(face.bold).toBe(false)
  })

  it('does not read an attribute whose name only ends in val', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    for (const attrs of ['w:interval="0"', 'x:val="0"']) {
      const face = runFace(
        {
          id: 'r1',
          text: 'x',
          preservedXmlFragments: [`<w:rPr><w:strike ${attrs}/></w:rPr>`],
        },
        paragraph,
        [],
      )
      expect(face.strike).toBe(true)
    }
  })

  it('does not leak history out of an unclosed tracked change', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:b/><w:rPrChange w:id="1"><w:rPr><w:strike/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.bold).toBe(true)
    expect(face.strike).toBeUndefined()
  })

  it('lowercases highlight and vertical align values', () => {
    const paragraph = paragraphFace(
      { id: 'p1', runs: [], preservedXmlFragments: [] },
      [],
    )
    const face = runFace(
      {
        id: 'r1',
        text: 'x',
        preservedXmlFragments: [
          '<w:rPr><w:highlight w:val="DARKBLUE"/><w:vertAlign w:val="SUPERSCRIPT"/></w:rPr>',
        ],
      },
      paragraph,
      [],
    )
    expect(face.highlight).toBe('#000080')
    expect(face.vertAlign).toBe('superscript')
    expect(runCss(face).verticalAlign).toBe('super')
  })

  it('leaves an explicit baseline unraised and maps a subscript down', () => {
    expect(runCss({ vertAlign: 'baseline' }).verticalAlign).toBeUndefined()
    expect(runCss({ vertAlign: 'subscript' }).verticalAlign).toBe('sub')
    expect(runCss({ highlight: undefined }).backgroundColor).toBeUndefined()
  })
})
