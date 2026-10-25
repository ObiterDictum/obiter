import { effectiveParagraph } from './document-model-text'
import { replaceRunRange } from './document-run-range'
import { describe, expect, it } from 'bun:test'
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
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
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
        from: 6,
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
          inlinePosition: null,
          elementName: 'ins',
          text: 'Alice',
          storyPartName: 'word/document.xml',
          runId: 'r1',
          paragraphId: 'p1',
        },
        {
          id: 'c2',
          kind: 'delete',
          inlinePosition: null,
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

it('keeps untouched source text and paragraph identity while applying unrelated drafts', () => {
  const paragraph = {
    id: 'p',
    runs: [{ id: 'r', text: 'a\r\nb', preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
  expect(effectiveParagraph(paragraph, { other: 'edited' })).toBe(paragraph)
})

it('normalises inserted draft text at the range-write boundary', () => {
  const runs = replaceRunRange(
    [{ id: 'r', text: 'before after', preservedXmlFragments: [] }],
    7,
    7,
    'one\r\ntwo\r',
  )
  expect(runs.map((run) => run.text).join('')).toBe('before one\ntwo\nafter')
  const source = [{ id: 'r', text: 'a\r\nb', preservedXmlFragments: [] }]
  expect(replaceRunRange(source, 4, 4, '!')[0]?.text).toBe('a\nb!')
})
