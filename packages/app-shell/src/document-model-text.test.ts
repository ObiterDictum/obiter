import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  modelPlainText,
  paragraphHasUnmodelled,
  runChangeKinds,
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
