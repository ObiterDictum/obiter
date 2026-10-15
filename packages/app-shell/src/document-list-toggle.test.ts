import { describe, expect, it } from 'bun:test'
import { emptyFormatDrafts } from './document-format-edits'
import {
  numberingKind,
  paragraphStartOverride,
  pickNumberingId,
  toggleParagraphList,
  toggleParagraphListOnTargets,
} from './document-list-toggle'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

const model: DocumentModelWire = {
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs: [
        {
          id: 'p1',
          runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
          preservedXmlFragments: [],
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
    {
      numberingId: '2',
      sourceFragment: '<w:num w:numId="2"/>',
      levels: [{ ilvl: 0, numFmt: 'bullet' }],
    },
  ],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
}

describe('list toggle', () => {
  it('classifies numbering instances and toggles them on a paragraph', () => {
    expect(numberingKind(model.numbering[0]?.levels)).toBe('multilevel')
    expect(numberingKind(model.numbering[1]?.levels)).toBe('bullet')
    expect(pickNumberingId(model, 'number')).toBeUndefined()
    expect(pickNumberingId(model, 'multilevel')).toBe('1')
    const paragraph = model.stories[0]?.paragraphs[0]
    if (!paragraph) throw new Error('missing paragraph')
    const on = toggleParagraphList(
      emptyFormatDrafts,
      model,
      paragraph,
      'multilevel',
    )
    expect(on.numbering.p1).toEqual({ numId: '1', ilvl: 0 })
    const off = toggleParagraphList(on, model, paragraph, 'multilevel')
    expect(off.numbering.p1).toEqual({ numId: null })
  })

  it('picks the lowest numeric instance when several match a kind', () => {
    const ambiguous: DocumentModelWire = {
      ...model,
      numbering: [
        {
          numberingId: '10',
          sourceFragment: '<w:num w:numId="10"/>',
          levels: [{ ilvl: 0, numFmt: 'decimal' }],
        },
        {
          numberingId: '2',
          sourceFragment: '<w:num w:numId="2"/>',
          levels: [{ ilvl: 0, numFmt: 'decimal' }],
        },
      ],
    }
    expect(pickNumberingId(ambiguous, 'number')).toBe('2')
  })

  it('toggles a whole selection on, then off, in one action', () => {
    const story = model.stories[0]
    if (!story) throw new Error('missing story')
    const plain: DocumentParagraphWire = {
      id: 'p2',
      runs: [{ id: 'r2', text: 'Two', preservedXmlFragments: [] }],
      preservedXmlFragments: [],
    }
    const selectionModel: DocumentModelWire = {
      ...model,
      stories: [
        {
          ...story,
          paragraphs: [
            {
              ...story.paragraphs[0],
              preservedXmlFragments: [
                '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="2"/></w:numPr></w:pPr>',
              ],
            },
            plain,
          ],
        },
      ],
    }
    const paragraphs = selectionModel.stories[0]?.paragraphs ?? []
    const on = toggleParagraphListOnTargets(
      emptyFormatDrafts,
      selectionModel,
      paragraphs,
      'bullet',
    )
    expect(on.numbering.p1).toEqual({ numId: '2', ilvl: 0 })
    expect(on.numbering.p2).toEqual({ numId: '2', ilvl: 0 })
    const off = toggleParagraphListOnTargets(
      on,
      selectionModel,
      paragraphs,
      'bullet',
    )
    expect(off.numbering.p1).toEqual({ numId: null })
    expect(off.numbering.p2).toEqual({ numId: null })
  })

  it('reads the effective start override from the instance and the draft', () => {
    const paragraph: DocumentParagraphWire = {
      id: 'p1',
      runs: [{ id: 'r1', text: 'Hello', preservedXmlFragments: [] }],
      preservedXmlFragments: [
        '<w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>',
      ],
    }
    const restarted: DocumentModelWire = {
      ...model,
      numbering: [
        {
          ...model.numbering[0],
          startOverride: 5,
          sourceFragment:
            '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="5"/></w:lvlOverride></w:num>',
          levels: [
            { ilvl: 0, start: 5, numFmt: 'decimal' },
            { ilvl: 1, start: 1, numFmt: 'lowerLetter' },
          ],
        },
        ...model.numbering.slice(1),
      ],
    }
    expect(
      paragraphStartOverride(restarted, emptyFormatDrafts, paragraph),
    ).toBe(5)
    const draft = {
      ...emptyFormatDrafts,
      numbering: { p1: { numId: '1', ilvl: 0, startOverride: 1 } },
    }
    expect(paragraphStartOverride(restarted, draft, paragraph)).toBe(1)
  })

  it('reads the override for the level the paragraph actually uses', () => {
    const paragraph = (id: string, ilvl: number): DocumentParagraphWire => ({
      id,
      runs: [{ id: `${id}-r`, text: 'Hello', preservedXmlFragments: [] }],
      preservedXmlFragments: [
        `<w:pPr><w:numPr><w:ilvl w:val="${String(ilvl)}"/><w:numId w:val="1"/></w:numPr></w:pPr>`,
      ],
    })
    const perLevel: DocumentModelWire = {
      ...model,
      numbering: [
        {
          ...model.numbering[0],
          startOverride: 7,
          sourceFragment:
            '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="2"><w:startOverride w:val="7"/></w:lvlOverride></w:num>',
          levels: [
            { ilvl: 0, start: 1, numFmt: 'decimal' },
            { ilvl: 1, start: 1, numFmt: 'lowerLetter' },
            { ilvl: 2, start: 7, numFmt: 'lowerRoman' },
          ],
        },
        ...model.numbering.slice(1),
      ],
    }
    // The instance's first override is at ilvl 2, so ilvl 0 must not read it.
    expect(
      paragraphStartOverride(perLevel, emptyFormatDrafts, paragraph('p0', 0)),
    ).toBeUndefined()
    expect(
      paragraphStartOverride(perLevel, emptyFormatDrafts, paragraph('p2', 2)),
    ).toBe(7)
  })

  it('does not read a later override as a self-closing one', () => {
    const paragraph = (id: string, ilvl: number): DocumentParagraphWire => ({
      id,
      runs: [{ id: `${id}-r`, text: 'Hello', preservedXmlFragments: [] }],
      preservedXmlFragments: [
        `<w:pPr><w:numPr><w:ilvl w:val="${String(ilvl)}"/><w:numId w:val="1"/></w:numPr></w:pPr>`,
      ],
    })
    const overridden: DocumentModelWire = {
      ...model,
      numbering: [
        {
          numberingId: '1',
          sourceFragment:
            '<w:num w:numId="1"><w:abstractNumId w:val="0"/><w:lvlOverride w:ilvl="0"/><w:lvlOverride w:ilvl="2"><w:startOverride w:val="7"/></w:lvlOverride></w:num>',
          levels: [
            { ilvl: 0, start: 1, numFmt: 'decimal' },
            { ilvl: 2, start: 7, numFmt: 'lowerRoman' },
          ],
        },
      ],
    }
    // The self-closing override at ilvl 0 has no start, so the ilvl-2 value
    // must not be read for it.
    expect(
      paragraphStartOverride(overridden, emptyFormatDrafts, paragraph('p0', 0)),
    ).toBeUndefined()
    expect(
      paragraphStartOverride(overridden, emptyFormatDrafts, paragraph('p2', 2)),
    ).toBe(7)
  })
})
