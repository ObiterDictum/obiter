import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  collectFormatOperations,
  documentFormatToolbar,
  emphasisAddress,
  emptyFormatDrafts,
  formattedModel,
  indentList,
  mergeEmphasis,
  outdentList,
  type FormatDrafts,
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

describe('emphasis addressing from the caret selection', () => {
  const paragraph = {
    id: 'p1',
    runs: [
      { id: 'r1', text: 'Hello ', preservedXmlFragments: [] },
      { id: 'r2', text: 'world', preservedXmlFragments: [] },
    ],
    preservedXmlFragments: [],
  }

  it('emits a paragraph range for a non-empty selection', () => {
    expect(emphasisAddress(paragraph, 0, 2, 4)).toEqual({
      paragraphId: 'p1',
      from: 2,
      to: 4,
    })
    expect(emphasisAddress(paragraph, 5, 0, 2)).toEqual({
      paragraphId: 'p1',
      from: 5,
      to: 7,
    })
  })

  it('formats only the run that holds a collapsed caret', () => {
    expect(emphasisAddress(paragraph, 0, 8, 8)).toEqual({ runId: 'r2' })
    expect(emphasisAddress(paragraph, 0, 2, 2)).toEqual({ runId: 'r1' })
  })
})

describe('tracked emphasis from the client path', () => {
  it('does not queue a range emphasis while track changes is on', () => {
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      model,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      { from: 1, to: 4 },
      true,
    )
    expect(toolbar.emphasisUnavailable).toMatch(
      /partial formatting is not yet recorded as a tracked change/i,
    )
    toolbar.onToggleBold()
    expect(format.emphasis).toEqual([])
  })

  it('still queues whole-run emphasis while track changes is on', () => {
    let format: FormatDrafts = emptyFormatDrafts
    const toolbar = documentFormatToolbar(
      model,
      format,
      'p1',
      (update) => {
        format = update(format)
      },
      { from: 2, to: 2 },
      true,
    )
    expect(toolbar.emphasisUnavailable).toBeUndefined()
    toolbar.onToggleBold()
    expect(format.emphasis).toEqual([{ runId: 'r1', bold: true }])
  })
})

describe('document format drafts', () => {
  it('collects a paragraph range emphasis operation from the selection', () => {
    expect(
      collectFormatOperations(
        model,
        {
          emphasis: [{ paragraphId: 'p1', from: 2, to: 4, bold: true }],
          paragraphStyles: {},
          numbering: {},
        },
        [],
      ),
    ).toEqual([
      {
        type: 'set_run_emphasis',
        paragraphId: 'p1',
        from: 2,
        to: 4,
        bold: true,
      },
    ])
  })

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

  it('keeps direct paragraph formatting when a numbering draft is painted', () => {
    const styled: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...model.stories[0],
          paragraphs: [
            {
              ...model.stories[0]?.paragraphs[0],
              preservedXmlFragments: [
                '<w:pPr><w:pStyle w:val="Heading1"/><w:shd w:val="clear" w:fill="F2F2F2"/></w:pPr>',
              ],
            },
          ],
        },
      ],
    }
    const painted = formattedModel(styled, {
      emphasis: [],
      paragraphStyles: {},
      numbering: { p1: { numId: '1', ilvl: 1 } },
    })
    const fragments =
      painted.stories[0]?.paragraphs[0]?.preservedXmlFragments ?? []
    expect(fragments.join('')).toContain('<w:pStyle w:val="Heading1"/>')
    expect(fragments.join('')).toContain(
      '<w:shd w:val="clear" w:fill="F2F2F2"/>',
    )
    expect(fragments.join('')).toContain('<w:ilvl w:val="1"/>')
  })
})
