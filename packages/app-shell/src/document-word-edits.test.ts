import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  applyDeleteBackward,
  applyDeleteForward,
  applySplitParagraph,
  applyWordEdit,
  emptyEditorState,
  replaceFindHits,
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

  it('refuses a join on a wire served without field metadata', () => {
    // A pre-field-metadata model cannot prove the joined-away paragraph
    // carries no stored field marker, and a server that old has no
    // writer-side split check either — so the join refuses rather than
    // risking a field split. Removing the field keys keeps the fixture a
    // genuine legacy response, not empty arrays.
    const legacy = JSON.parse(JSON.stringify(twoParagraphs)) as {
      stories: Record<string, unknown>[]
    }
    for (const story of legacy.stories) {
      delete story.fields
      delete story.unanchoredFieldParagraphIds
    }
    const wire = legacy as DocumentModelWire
    expect(
      applyDeleteBackward(wire, emptyEditorState(), {
        paragraphId: 'p2',
        offset: 0,
      }),
    ).toBeUndefined()
    // An in-run deletion removes no paragraph, so it still applies.
    expect(
      applyDeleteBackward(wire, emptyEditorState(), {
        paragraphId: 'p2',
        offset: 3,
      }),
    ).toBeDefined()
  })

  it('cannot remove the only paragraph', () => {
    const only: DocumentModelWire = {
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
    }
    expect(
      applyDeleteBackward(only, emptyEditorState(), {
        paragraphId: 'p1',
        offset: 0,
      }),
    ).toBeUndefined()
    expect(
      applyDeleteForward(only, emptyEditorState(), {
        paragraphId: 'p1',
        offset: 5,
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

describe('field-boundary joins', () => {
  // p2 holds the field's begin/separate, p4 its end; joining deletes the
  // joined paragraph's element wholesale.
  const fieldModel: DocumentModelWire = {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: ['p1', 'p2', 'p3', 'p4', 'p5'].map((id) => ({
          id,
          runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        })),
        preservedXmlFragments: [],
        fields: [
          {
            headId: 'p2',
            tailId: 'p4',
            closed: true,
            boundaryIds: ['p2', 'p4'],
            paragraphIds: ['p2', 'p3', 'p4'],
            resultIds: ['p2', 'p3'],
            instruction: ' TOA \\h \\c "1" ',
            rangeReplaceable: true,
            boundariesAnchored: true,
          },
        ],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
  }

  it('refuses to join away a paragraph holding only one boundary', () => {
    // Backspace at the start of the tail would merge it into p3 and drop
    // the field's `end` while `begin` survives — the join is refused.
    expect(
      applyDeleteBackward(fieldModel, emptyEditorState(), {
        paragraphId: 'p4',
        offset: 0,
      }),
    ).toBeUndefined()
    // The same hold applies in the other direction: joining the head away.
    expect(
      applyDeleteForward(fieldModel, emptyEditorState(), {
        paragraphId: 'p1',
        offset: 2,
      }),
    ).toBeUndefined()
    // A delete inside the text — no join — is unaffected.
    expect(
      applyDeleteForward(fieldModel, emptyEditorState(), {
        paragraphId: 'p1',
        offset: 1,
      }),
    ).toBeDefined()
  })

  it('joins the boundary away once the rest of the field is marked', () => {
    const result = applyDeleteBackward(
      fieldModel,
      { ...emptyEditorState(), deletedParagraphIds: ['p2', 'p3'] },
      { paragraphId: 'p4', offset: 0 },
    )
    expect(result?.state.deletedParagraphIds).toEqual(['p2', 'p3', 'p4'])
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
          fields: [],
          unanchoredFieldParagraphIds: [],
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

describe('replaceFindHits', () => {
  it('replaces one hit or all hits from the end of each paragraph', () => {
    const one = replaceFindHits(
      twoParagraphs,
      emptyEditorState(),
      [{ paragraphId: 'p1', start: 0, end: 5 }],
      'Hi',
      0,
    )
    expect(one?.state.drafts.r1).toBe('Hi')
    const all = replaceFindHits(
      twoParagraphs,
      emptyEditorState(),
      [
        { paragraphId: 'p1', start: 1, end: 2 },
        { paragraphId: 'p1', start: 3, end: 4 },
      ],
      '-',
      'all',
    )
    expect(all?.state.drafts.r1).toBe('H-l-o')
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
