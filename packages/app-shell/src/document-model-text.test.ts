import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  deleteCharBeforeOffset,
  modelPlainText,
  paragraphHasUnmodelled,
  paragraphPlainText,
  paragraphRunStart,
  runChangeKinds,
  sliceContainsOffset,
  sliceParagraphRuns,
  spliceRunSlice,
  textDiff,
} from './document-model-text'

function sampleModel(
  overrides: Partial<DocumentModelWire> = {},
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [
          {
            id: 'p1',
            runs: [
              {
                id: 'r1',
                text: 'Alice Example overview',
                preservedXmlFragments: [],
              },
            ],
            preservedXmlFragments: [],
          },
        ],
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    ...overrides,
  }
}

describe('modelPlainText', () => {
  it('joins document-story runs with paragraph breaks', () => {
    expect(modelPlainText(sampleModel())).toBe('Alice Example overview')
  })
})

describe('paragraphHasUnmodelled', () => {
  it('is true when a paragraph carries preserved XML', () => {
    const paragraph = sampleModel().stories[0]?.paragraphs[0]
    expect(paragraph && paragraphHasUnmodelled(paragraph)).toBe(false)
    expect(
      paragraphHasUnmodelled({
        id: 'p2',
        runs: [],
        preservedXmlFragments: ['<w:bookmarkStart w:id="1"/>'],
      }),
    ).toBe(true)
  })
})

describe('sliceParagraphRuns', () => {
  it('slices across runs using draft text when present', () => {
    const paragraph = {
      id: 'p1',
      runs: [
        { id: 'r1', text: 'Hello ', preservedXmlFragments: [] },
        { id: 'r2', text: 'world', preservedXmlFragments: [] },
      ],
      preservedXmlFragments: [],
    }
    expect(paragraphPlainText(paragraph, { r2: 'there' })).toBe('Hello there')
    expect(sliceParagraphRuns(paragraph, 6, 11, { r2: 'there' })).toEqual([
      {
        run: paragraph.runs[1],
        text: 'there',
      },
    ])
  })
})

describe('paragraph text edits', () => {
  const paragraph = {
    id: 'p1',
    runs: [
      { id: 'r1', text: 'with ', preservedXmlFragments: [] },
      { id: 'r2', text: 'Acme', preservedXmlFragments: [] },
    ],
    preservedXmlFragments: [],
  }

  it('reports the start offset of each run', () => {
    expect(paragraphRunStart(paragraph, 'r1')).toBe(0)
    expect(paragraphRunStart(paragraph, 'r2')).toBe(5)
  })

  it('deletes the character before a caret at a run boundary', () => {
    expect(deleteCharBeforeOffset(paragraph, undefined, 5)).toEqual({
      runId: 'r1',
      text: 'with',
    })
  })

  it('splices a slice edit back into the full run text', () => {
    expect(spliceRunSlice('Hello world', 0, 6, 11, 'there')).toBe('Hello there')
  })

  it('diffs typed text as a single replace range', () => {
    expect(textDiff('with Acme', 'withAcme')).toEqual({
      from: 4,
      to: 5,
      insert: '',
    })
  })

  it('treats the end of the last slice as inside that slice', () => {
    expect(sliceContainsOffset(5, 0, 5, 5)).toBe(true)
    expect(sliceContainsOffset(5, 0, 5, 11)).toBe(false)
    expect(sliceContainsOffset(5, 5, 11, 11)).toBe(true)
    expect(sliceContainsOffset(11, 0, 5, 5)).toBe(true)
  })
})

describe('runChangeKinds', () => {
  it('collects kinds for a run without exposing XML', () => {
    const kinds = runChangeKinds(
      [
        {
          id: 'c1',
          kind: 'insert',
          elementName: 'ins',
          text: 'Alice',
          storyPartName: 'word/document.xml',
          runId: 'r1',
          paragraphId: 'p1',
        },
        {
          id: 'c2',
          kind: 'delete',
          elementName: 'del',
          text: 'old',
          storyPartName: 'word/document.xml',
          runId: 'r2',
          paragraphId: 'p1',
        },
      ],
      'r1',
    )
    expect([...kinds]).toEqual(['insert'])
  })
})
