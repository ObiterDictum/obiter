import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectFormatOperations,
  formattedModel,
  indentList,
  mergeEmphasis,
  outdentList,
} from './document-format-edits'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          styleId: 'Heading1',
          runs: [
            {
              id: 'r1',
              text: 'Hello',
              preservedXmlFragments: ['<w:rPr/>'],
            },
          ],
          preservedXmlFragments: [
            '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
          ],
        },
      ],
      preservedXmlFragments: [],
    },
  ],
  styles: [],
  numbering: [
    {
      numberingId: '1',
      sourceFragment: '<w:num w:numId="1"/>',
      levels: [
        { ilvl: 0, numFmt: 'decimal' },
        { ilvl: 1, numFmt: 'lowerLetter' },
      ],
    },
  ],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
}

describe('document format drafts', () => {
  it('collects coalesced emphasis, style, and numbering operations', () => {
    expect(
      collectFormatOperations(
        model,
        {
          emphasis: [
            { runId: 'r1', bold: true },
            { runId: 'r1', italic: true },
          ],
          paragraphStyles: { p1: 'Base' },
          numbering: { p1: { numId: '1', ilvl: 1 } },
        },
        [],
      ),
    ).toEqual([
      { type: 'set_run_emphasis', runId: 'r1', italic: true },
      { type: 'set_paragraph_style', paragraphId: 'p1', styleId: 'Base' },
      {
        type: 'set_paragraph_numbering',
        paragraphId: 'p1',
        numId: '1',
        ilvl: 1,
      },
    ])
  })

  it('paints pending bold and list indent onto the local model', () => {
    const painted = formattedModel(model, {
      emphasis: [{ runId: 'r1', bold: true }],
      paragraphStyles: {},
      numbering: { p1: { numId: '1', ilvl: 1 } },
    })
    const paragraph = painted.stories[0]?.paragraphs[0]
    expect(paragraph?.runs[0]?.preservedXmlFragments.join('')).toContain(
      '<w:b/>',
    )
    expect(paragraph?.preservedXmlFragments.join('')).toContain(
      '<w:ilvl w:val="1"/>',
    )
  })

  it('indents then outdents using numbering levels', () => {
    const indented = indentList(
      { emphasis: [], paragraphStyles: {}, numbering: {} },
      model,
      model.stories[0]?.paragraphs[0] ?? {
        id: 'p1',
        runs: [],
        preservedXmlFragments: [],
      },
    )
    expect(indented.numbering.p1).toEqual({ numId: '1', ilvl: 1 })
    const outdented = outdentList(indented, model, {
      id: 'p1',
      runs: [],
      preservedXmlFragments: [],
    })
    expect(outdented.numbering.p1).toEqual({ numId: '1', ilvl: 0 })
  })

  it('merges later emphasis onto the same run', () => {
    expect(
      mergeEmphasis([{ runId: 'r1', bold: true }], {
        runId: 'r1',
        italic: true,
      }),
    ).toEqual([{ runId: 'r1', bold: true, italic: true }])
  })
})
