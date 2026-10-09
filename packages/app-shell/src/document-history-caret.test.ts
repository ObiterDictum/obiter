import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import { historyCaretPlacement } from './document-history-caret'
import type { EditorState } from './document-word-edits'

function model(
  paragraphs: Array<{ id: string; text: string }>,
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: paragraphs.map(({ id, text }) => ({
          id,
          runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        })),
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
}

function state(overrides: Partial<EditorState>): EditorState {
  return {
    drafts: {},
    inserts: [],
    deletedParagraphIds: [],
    extraRuns: {},
    ...overrides,
  }
}

const body = model([
  { id: 'p1', text: 'Hello' },
  { id: 'p2', text: 'tail' },
  { id: 'p3', text: 'third' },
])

describe('history caret placement', () => {
  it('seats the caret at the end of the paragraph before a removed stored one', () => {
    expect(
      historyCaretPlacement({
        model: body,
        before: { inserts: [], deletedParagraphIds: [] },
        restored: state({ deletedParagraphIds: ['p2'] }),
        anchor: 'p2',
      }),
    ).toEqual({ paragraphId: 'p1', offset: 'Hello'.length })
  })

  it('seats the caret at the end of the following paragraph when the first is removed', () => {
    expect(
      historyCaretPlacement({
        model: body,
        before: { inserts: [], deletedParagraphIds: [] },
        restored: state({ deletedParagraphIds: ['p1'] }),
        anchor: 'p1',
      }),
    ).toEqual({ paragraphId: 'p2', offset: 'tail'.length })
  })

  it('falls back to an insert anchor when the removed paragraph was an insert', () => {
    expect(
      historyCaretPlacement({
        model: body,
        before: {
          inserts: [{ clientId: 'i1', afterParagraphId: 'p2', text: 'draft' }],
          deletedParagraphIds: [],
        },
        restored: state({}),
        anchor: 'i1',
      }),
    ).toEqual({ paragraphId: 'p2', offset: 'tail'.length })
  })

  it('takes the caret for an insert the step restored', () => {
    expect(
      historyCaretPlacement({
        model: body,
        before: { inserts: [], deletedParagraphIds: [] },
        restored: state({
          inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: '' }],
        }),
        anchor: 'p1',
      }),
    ).toEqual({ paragraphId: 'i1', offset: 0 })
  })

  it('keeps the caret on a surviving paragraph', () => {
    expect(
      historyCaretPlacement({
        model: body,
        before: { inserts: [], deletedParagraphIds: [] },
        restored: state({ deletedParagraphIds: ['p3'] }),
        anchor: 'p1',
      }),
    ).toBeNull()
  })

  it('falls back to a surviving neighbour when the insert anchor is removed too', () => {
    // The step removed the insert and the stored paragraph it was placed after,
    // so the insert's own anchor cannot hold the caret either.
    expect(
      historyCaretPlacement({
        model: body,
        before: {
          inserts: [{ clientId: 'i1', afterParagraphId: 'p2', text: 'draft' }],
          deletedParagraphIds: [],
        },
        restored: state({ deletedParagraphIds: ['p2'] }),
        anchor: 'i1',
      }),
    ).toEqual({ paragraphId: 'p1', offset: 'Hello'.length })
  })
})
