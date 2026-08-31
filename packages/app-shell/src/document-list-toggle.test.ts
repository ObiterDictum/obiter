import { describe, expect, it } from 'vitest'
import { emptyFormatDrafts } from './document-format-edits'
import {
  numberingKind,
  pickNumberingId,
  toggleParagraphList,
} from './document-list-toggle'
import type { DocumentModelWire } from '@obiter/contracts'

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
})
