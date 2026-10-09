import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  planParagraphDeletion,
  type ParagraphDeletionPlan,
} from './document-paragraph-deletion'
import type { LocalInsert } from './document-edits'

function model(
  ids: readonly string[],
  fields: DocumentModelWire['stories'][number]['fields'] = [],
  unanchoredFieldParagraphIds: string[] = [],
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: ids.map((id) => ({
          id,
          runs: [{ id: `${id}-r`, text: id, preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        })),
        preservedXmlFragments: [],
        fields,
        unanchoredFieldParagraphIds,
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

const insert: LocalInsert = {
  clientId: 'insert-1',
  afterParagraphId: 'p1',
  text: 'Pending',
}

const empty = { inserts: [], deletedParagraphIds: [] }

function selectId(plan: ParagraphDeletionPlan): string | null {
  return plan.kind === 'deleted' ? plan.selectId : null
}

describe('planParagraphDeletion', () => {
  it('refuses deleting the only paragraph without returning state', () => {
    const plan = planParagraphDeletion(model(['p1']), empty, 'p1')
    expect(plan).toEqual({ kind: 'refused', reason: 'last-paragraph' })
  })

  it('refuses when no model is loaded', () => {
    expect(planParagraphDeletion(undefined, empty, 'p1')).toEqual({
      kind: 'refused',
      reason: 'last-paragraph',
    })
  })

  it('deletes one of two paragraphs and selects the next survivor', () => {
    const plan = planParagraphDeletion(
      model(['p1', 'p2']),
      { inserts: [], deletedParagraphIds: [] },
      'p1',
    )
    expect(plan.kind).toBe('deleted')
    expect(selectId(plan)).toBe('p2')
    if (plan.kind !== 'deleted') throw new Error('expected a deletion')
    expect(plan.state.deletedParagraphIds).toEqual(['p1'])
  })

  it('selects the previous survivor when the last paragraph is deleted', () => {
    const plan = planParagraphDeletion(
      model(['p1', 'p2']),
      { inserts: [], deletedParagraphIds: [] },
      'p2',
    )
    expect(selectId(plan)).toBe('p1')
  })

  it('refuses the second deletion after a first has been planned', () => {
    expect(
      planParagraphDeletion(
        model(['p1', 'p2']),
        { inserts: [], deletedParagraphIds: ['p1'] },
        'p2',
      ),
    ).toEqual({ kind: 'refused', reason: 'last-paragraph' })
  })

  it('treats a paragraph already pending deletion as unchanged', () => {
    expect(
      planParagraphDeletion(
        model(['p1', 'p2']),
        { inserts: [], deletedParagraphIds: ['p2'] },
        'p2',
      ),
    ).toEqual({ kind: 'unchanged' })
  })

  it('removes a pending insert and selects its anchor', () => {
    const plan = planParagraphDeletion(
      model(['p1', 'p2']),
      { inserts: [insert], deletedParagraphIds: [] },
      'insert-1',
    )
    expect(selectId(plan)).toBe('p1')
    if (plan.kind !== 'deleted') throw new Error('expected a deletion')
    expect(plan.state.inserts).toEqual([])
  })

  it('selects a rendered survivor when the insert anchor is pending-deleted', () => {
    // insert-1 sits after p1, and p1 is already pending deletion, so the anchor
    // does not render. The survivor must come from the effective flow instead.
    const plan = planParagraphDeletion(
      model(['p1', 'p2']),
      { inserts: [insert], deletedParagraphIds: ['p1'] },
      'insert-1',
    )
    expect(selectId(plan)).toBe('p2')
  })

  it('refuses removing the last effective pending insert', () => {
    expect(
      planParagraphDeletion(
        model(['p1']),
        { inserts: [insert], deletedParagraphIds: ['p1'] },
        'insert-1',
      ),
    ).toEqual({ kind: 'refused', reason: 'last-paragraph' })
  })

  describe('field-boundary deletions', () => {
    // p2 holds the field's begin/separate, p4 its end — p3 carries a
    // result but no marker.
    const field = {
      headId: 'p2',
      tailId: 'p4',
      closed: true,
      boundaryIds: ['p2', 'p4'],
      paragraphIds: ['p2', 'p3', 'p4'],
      resultIds: ['p2', 'p3'],
      instruction: ' TOA \\h \\c "1" ',
      rangeReplaceable: true,
      boundariesAnchored: true,
    }
    const fieldModel = () => model(['p1', 'p2', 'p3', 'p4', 'p5'], [field])

    it('refuses deleting a paragraph holding only part of the field', () => {
      expect(planParagraphDeletion(fieldModel(), empty, 'p4')).toEqual({
        kind: 'refused',
        reason: 'field-boundary',
      })
      expect(planParagraphDeletion(fieldModel(), empty, 'p2')).toEqual({
        kind: 'refused',
        reason: 'field-boundary',
      })
    })

    it('refuses deleting a paragraph an unanchored boundary hides in', () => {
      const unanchored = model(['p1', 'p2', 'p3'], [], ['p2'])
      expect(planParagraphDeletion(unanchored, empty, 'p2')).toEqual({
        kind: 'refused',
        reason: 'field-boundary',
      })
    })

    it('allows deleting a covered paragraph carrying no boundary', () => {
      const plan = planParagraphDeletion(fieldModel(), empty, 'p3')
      expect(plan.kind).toBe('deleted')
    })

    it("allows deleting once the field's other boundary is already marked", () => {
      const plan = planParagraphDeletion(
        fieldModel(),
        { inserts: [], deletedParagraphIds: ['p2', 'p3'] },
        'p4',
      )
      expect(plan.kind).toBe('deleted')
    })
  })
})
