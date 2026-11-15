import { describe, expect, it } from 'bun:test'
import {
  appliableParkedEdits,
  parkedDraftClipboardText,
  reviewParkedDraftEdits,
} from './document-parked-draft'
import { emptyDraftState, type DraftState } from './document-draft-state'
import { textParagraph, wireModel } from './document-wire-test-support'

function parked(state: Partial<DraftState>): DraftState {
  return { ...emptyDraftState(), ...state }
}

const doc = (...texts: string[]) =>
  wireModel(
    texts.map((text, index) => textParagraph(`p${String(index + 1)}`, text)),
  )

describe('reviewParkedDraftEdits', () => {
  it('shows the old and new text of each parked edit per paragraph', () => {
    const base = doc('Hello world')
    const review = reviewParkedDraftEdits(
      base,
      base,
      parked({ drafts: { 'p1-r': 'Hello there' } }),
      0,
      emptyDraftState(),
    )
    expect(review.edits).toHaveLength(1)
    expect(review.edits[0]).toMatchObject({
      paragraphId: 'p1',
      paragraphLabel: 'Hello world',
      kind: 'text',
      oldText: 'Hello world',
      newText: 'Hello there',
      status: 'appliable',
    })
  })

  it('marks an edit appliable only while its paragraph base text is unchanged', () => {
    const base = doc('Hello world', 'Second')
    const current = doc('Hello world', 'Second moved on')
    const review = reviewParkedDraftEdits(
      base,
      current,
      parked({
        drafts: { 'p1-r': 'Hi', 'p2-r': 'Changed second' },
      }),
      0,
      emptyDraftState(),
    )
    const byParagraph = new Map(
      review.edits.map((edit) => [edit.paragraphId, edit.status]),
    )
    expect(byParagraph.get('p1')).toBe('appliable')
    expect(byParagraph.get('p2')).toBe('changed')
    expect(review.appliableCount).toBe(1)
    expect(review.changedCount).toBe(1)
  })

  it('marks an edit changed by someone else when its paragraph is gone', () => {
    const base = doc('Hello world', 'Second')
    const current = doc('Second')
    const review = reviewParkedDraftEdits(
      base,
      current,
      parked({ drafts: { 'p1-r': 'Lost edit' } }),
      0,
      emptyDraftState(),
    )
    expect(review.edits[0]?.status).toBe('changed')
    expect(review.edits[0]?.newText).toBe('Lost edit')
  })

  it('marks an edit changed when the current draft already touched that run', () => {
    const base = doc('Hello world')
    const review = reviewParkedDraftEdits(
      base,
      base,
      parked({ drafts: { 'p1-r': 'Parked text' } }),
      0,
      parked({ drafts: { 'p1-r': 'Newer typing' } }),
    )
    expect(review.edits[0]?.status).toBe('changed')
  })

  it('lists parked paragraph deletions and inserts for review', () => {
    const base = doc('Alpha', 'Bravo')
    const review = reviewParkedDraftEdits(
      base,
      base,
      parked({
        deletedParagraphIds: ['p1'],
        inserts: [
          { clientId: 'ins_1', afterParagraphId: 'p2', text: 'Fresh line' },
        ],
      }),
      0,
      emptyDraftState(),
    )
    expect(review.edits.map((edit) => edit.kind)).toEqual(['delete', 'insert'])
    expect(review.edits.every((edit) => edit.status === 'appliable')).toBe(true)
  })

  it('collects only the appliable edits for re-application', () => {
    const base = doc('Hello world', 'Second')
    const current = doc('Hello world', 'Second moved on')
    const review = reviewParkedDraftEdits(
      base,
      current,
      parked({
        drafts: { 'p1-r': 'Hi', 'p2-r': 'Changed second' },
        deletedParagraphIds: ['p2'],
      }),
      0,
      emptyDraftState(),
    )
    expect(appliableParkedEdits(review.edits)).toEqual({
      drafts: { 'p1-r': 'Hi' },
      deletedParagraphIds: [],
      inserts: [],
    })
  })

  it('keeps changed edits copyable with their texts', () => {
    const base = doc('Hello world')
    const current = doc('Hello world edited')
    const review = reviewParkedDraftEdits(
      base,
      current,
      parked({ drafts: { 'p1-r': 'Parked rewrite' } }),
      0,
      emptyDraftState(),
    )
    const text = parkedDraftClipboardText(review)
    expect(text).toContain('Changed by someone else')
    expect(text).toContain('Hello world')
    expect(text).toContain('Parked rewrite')
  })
})
