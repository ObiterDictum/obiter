import { describe, expect, it } from 'bun:test'

import { emptyDraftState } from './document-draft-state'
import { partitionFormatDrafts } from './document-format-partition'
import type { LocalInsert } from './document-story-flow'

const insert: LocalInsert = {
  clientId: 'ins1',
  afterParagraphId: 'p1',
  text: 'New',
}

describe('format draft partition', () => {
  it('blocks list formatting keyed to a paragraph that has not been saved yet', () => {
    const state = emptyDraftState()
    state.format.numbering.ins1 = { numId: '1', ilvl: 0 }

    const result = partitionFormatDrafts(
      state,
      new Set(),
      new Map([[insert.clientId, insert]]),
      emptyDraftState(),
    )

    expect(result.covered).toEqual([])
    expect(result.blocked).toEqual([
      expect.objectContaining({
        reason:
          'List formatting on a paragraph that has not been saved yet cannot be sent separately.',
      }),
    ])
  })

  it('keeps a pending insert style as a covered slot that rides on the insert', () => {
    const state = emptyDraftState()
    state.format.paragraphStyles.ins1 = 'Heading1'
    const keep = emptyDraftState()

    const result = partitionFormatDrafts(
      state,
      new Set(),
      new Map([[insert.clientId, insert]]),
      keep,
    )

    expect(result.blocked).toEqual([])
    expect(result.covered).toEqual([
      expect.objectContaining({ kind: 'paragraph-style', paragraphId: 'ins1' }),
    ])
    expect(keep.format.paragraphStyles).toEqual({ ins1: 'Heading1' })
  })
})
