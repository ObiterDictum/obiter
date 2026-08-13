import { describe, expect, it } from 'vitest'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  applyDeleteBackward,
  applyDeleteForward,
  applySplitParagraph,
  applyWordEdit,
  emptyEditorState,
} from './document-word-edits'

const twoParagraphs: DocumentModelWire = {
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
        {
          id: 'p2',
          runs: [{ id: 'r2', text: 'World', preservedXmlFragments: [] }],
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
}

describe('applyDeleteBackward', () => {
  it('joins onto the previous paragraph while keeping the moved run', () => {
    const result = applyDeleteBackward(twoParagraphs, emptyEditorState(), {
      paragraphId: 'p2',
      offset: 0,
    })
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 5 })
    expect(result?.state.deletedParagraphIds).toEqual(['p2'])
    expect(result?.state.extraRuns.p1).toEqual([
      { id: 'r2', text: 'World', preservedXmlFragments: [] },
    ])
  })

  it('deletes the previous character inside a run', () => {
    const result = applyDeleteBackward(twoParagraphs, emptyEditorState(), {
      paragraphId: 'p1',
      offset: 5,
    })
    expect(result?.state.drafts.r1).toBe('Hell')
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 4 })
  })

  it('does not join the first paragraph', () => {
    expect(
      applyDeleteBackward(twoParagraphs, emptyEditorState(), {
        paragraphId: 'p1',
        offset: 0,
      }),
    ).toBeUndefined()
  })
})

describe('applyDeleteForward', () => {
  it('joins the next paragraph at the end of the current one', () => {
    const result = applyDeleteForward(twoParagraphs, emptyEditorState(), {
      paragraphId: 'p1',
      offset: 5,
    })
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 5 })
    expect(result?.state.deletedParagraphIds).toEqual(['p2'])
    expect(result?.state.extraRuns.p1).toEqual([
      { id: 'r2', text: 'World', preservedXmlFragments: [] },
    ])
  })
})

describe('applySplitParagraph', () => {
  it('moves the remainder into a new paragraph at the caret', () => {
    const result = applySplitParagraph(
      twoParagraphs,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 2 },
      'ins1',
    )
    expect(result?.caret).toEqual({ paragraphId: 'ins1', offset: 0 })
    expect(result?.state.drafts.r1).toBe('He')
    expect(result?.state.inserts).toEqual([
      {
        clientId: 'ins1',
        afterParagraphId: 'p1',
        text: 'llo',
        runs: [{ id: 'ins1-r0', text: 'llo', preservedXmlFragments: [] }],
      },
    ])
  })

  it('keeps text typed into a new paragraph when Enter splits it again', () => {
    const split = applySplitParagraph(
      twoParagraphs,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 5 },
      'ins1',
    )
    if (!split) throw new Error('expected split')
    const typed = {
      ...split.state,
      inserts: split.state.inserts.map((item) =>
        item.clientId === 'ins1' ? { ...item, text: 'Signed' } : item,
      ),
    }
    const again = applySplitParagraph(
      twoParagraphs,
      typed,
      { paragraphId: 'ins1', offset: 6 },
      'ins2',
    )
    expect(
      again?.state.inserts.find((item) => item.clientId === 'ins1')?.text,
    ).toBe('Signed')
    expect(
      again?.state.inserts.find((item) => item.clientId === 'ins2')?.text,
    ).toBe('')
  })

  it('splits a paragraph that has no runs yet', () => {
    const empty: DocumentModelWire = {
      ...twoParagraphs,
      stories: [
        {
          partName: 'word/document.xml',
          kind: 'document',
          paragraphs: [
            {
              id: 'p1',
              runs: [],
              preservedXmlFragments: [],
            },
          ],
          preservedXmlFragments: [],
        },
      ],
    }
    const result = applySplitParagraph(
      empty,
      emptyEditorState(),
      { paragraphId: 'p1', offset: 0 },
      'ins1',
    )
    expect(result?.caret).toEqual({ paragraphId: 'ins1', offset: 0 })
    expect(result?.state.inserts).toHaveLength(1)
  })
})

describe('applyWordEdit', () => {
  it('dispatches replace onto the current paragraph', () => {
    const result = applyWordEdit(
      twoParagraphs,
      emptyEditorState(),
      {
        type: 'replace',
        paragraphId: 'p1',
        offset: 5,
        from: 5,
        to: 5,
        insert: ' there',
      },
      'ins1',
    )
    expect(result?.caret).toEqual({ paragraphId: 'p1', offset: 11 })
    expect(result?.state.drafts.r1).toBe('Hello there')
  })
})
