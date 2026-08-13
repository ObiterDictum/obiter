import { describe, expect, it } from 'vitest'

import { numberingXml } from '../../fixtures/fixture-parts'
import { parseNumbering } from './numbering'

describe('parseNumbering', () => {
  it('attaches abstract levels to each numbering instance', () => {
    const numbering = parseNumbering(numberingXml)
    expect(numbering).toHaveLength(2)
    expect(numbering[0]).toMatchObject({
      numberingId: '1',
      abstractNumberingId: '0',
      levels: [
        { ilvl: 0, start: 1, numFmt: 'decimal' },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter' },
      ],
    })
    expect(numbering[1]).toMatchObject({
      numberingId: '2',
      startOverride: 1,
      levels: [
        { ilvl: 0, start: 1, numFmt: 'decimal' },
        { ilvl: 1, start: 1, numFmt: 'lowerLetter' },
      ],
    })
  })

  it('applies a per-level start override onto the copied abstract level', () => {
    const xml = `<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:start w:val="1"/><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/><w:pPr><w:ind w:left="720" w:hanging="360"/></w:pPr></w:lvl></w:abstractNum><w:num w:numId="3"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="4"/></w:lvlOverride></w:num></w:numbering>`
    expect(parseNumbering(xml)[0]).toMatchObject({
      numberingId: '3',
      startOverride: 4,
      levels: [
        {
          ilvl: 0,
          start: 4,
          numFmt: 'decimal',
          lvlText: '%1.',
          indentLeftTwips: 720,
          hangingTwips: 360,
        },
      ],
    })
  })
})
