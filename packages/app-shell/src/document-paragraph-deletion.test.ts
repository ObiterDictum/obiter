import { describe, expect, it } from 'bun:test'
import {
  documentModelWireSchema,
  type DocumentModelWire,
} from '@obiter/contracts'
import { emptyDraftState } from './document-draft-state'
import { FIELD_METADATA_MESSAGE, type LocalInsert } from './document-edits'
import {
  planParagraphDeletion,
  type ParagraphDeletionPlan,
} from './document-paragraph-deletion'
import { partitionDraftState } from './document-save-partition'

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

  describe('a wire without field metadata', () => {
    // The model a server that predates field metadata serves: the same
    // wire minus the keys the parser now guarantees. Serialising then
    // deleting keeps the fixture a genuine legacy response — keys absent,
    // not empty arrays — standing in for the response `apiFetch` trusts
    // without schema-checking it.
    const legacyModel = (ids: readonly string[]): DocumentModelWire => {
      const legacy = JSON.parse(JSON.stringify(model(ids))) as {
        stories: Record<string, unknown>[]
      }
      for (const story of legacy.stories) {
        delete story.fields
        delete story.unanchoredFieldParagraphIds
      }
      return legacy as DocumentModelWire
    }

    it('fails model validation, so a cached legacy model regenerates', () => {
      expect(
        documentModelWireSchema.safeParse(legacyModel(['p1', 'p2'])).success,
      ).toBe(false)
    })

    it('refuses removing a stored paragraph with the named reason', () => {
      for (const id of ['p1', 'p2']) {
        expect(
          planParagraphDeletion(legacyModel(['p1', 'p2']), empty, id),
        ).toEqual({ kind: 'refused', reason: 'field-metadata' })
      }
    })

    it('still removes a pending insert, which holds no stored markup', () => {
      const plan = planParagraphDeletion(
        legacyModel(['p1', 'p2']),
        { inserts: [insert], deletedParagraphIds: [] },
        'insert-1',
      )
      expect(plan.kind).toBe('deleted')
    })

    it('blocks the removal at the save partition with the same reason', () => {
      const partition = partitionDraftState(legacyModel(['p1', 'p2']), {
        ...emptyDraftState(),
        deletedParagraphIds: ['p1'],
      })
      expect(partition.keep.deletedParagraphIds).toEqual([])
      expect(partition.blocked).toEqual([
        expect.objectContaining({
          slot: expect.objectContaining({ kind: 'delete', paragraphId: 'p1' }),
          reason: FIELD_METADATA_MESSAGE,
        }),
      ])
    })
  })
})
