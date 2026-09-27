import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import {
  emptyDraftState,
  isPendingBaselineId,
  planDocumentSave,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'
import {
  resolveBaselineIdentities,
  translateSnapshot,
  type SaveBaseline,
} from './document-history-baseline'

function model(
  paragraphs: Array<{ id: string; run: string; text: string }>,
): DocumentModelWire {
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: paragraphs.map(({ id, run, text }) => ({
          id,
          runs: [{ id: run, text, preservedXmlFragments: [] }],
          preservedXmlFragments: [],
        })),
        preservedXmlFragments: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
  }
}

const fromModel = model([
  { id: 'p1', run: 'r1', text: 'Hello' },
  { id: 'p2', run: 'r2', text: 'tail' },
])

// What the server returns after saving: re-parsed identities, and the inserted
// paragraph named p3.
const savedModel = model([
  { id: 'p1', run: 'r1', text: 'Hello' },
  { id: 'p3', run: 'r3', text: 'Second' },
  { id: 'p2', run: 'r2', text: 'tail' },
])

function baseline(overrides: Partial<SaveBaseline>): SaveBaseline {
  return {
    covered: [],
    sent: emptyDraftState(),
    fromModel,
    ...overrides,
  }
}

function runTextSlot(runId: string): DraftSlot {
  return { kind: 'run-text', key: `run:${runId}`, runId }
}

function insertSlot(clientId: string): DraftSlot {
  return { kind: 'insert', key: `insert:${clientId}`, clientId }
}

function deleteSlot(paragraphId: string): DraftSlot {
  return { kind: 'delete', key: `delete:${paragraphId}`, paragraphId }
}

describe('translateSnapshot', () => {
  it('re-expresses a pre-edit snapshot as an override on the saved run', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [runTextSlot('r1')],
      sent,
      fromModel,
      toModel: model([
        { id: 'p1', run: 'r1', text: 'Hello world' },
        { id: 'p2', run: 'r2', text: 'tail' },
      ]),
    })
    // The snapshot described 'Hello'; against the saved model that is now an
    // override, so undo reverses the saved edit instead of doing nothing.
    expect(translated?.drafts).toEqual({ r1: 'Hello' })
  })

  it('drops a covered override a snapshot no longer holds', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
    }
    const translated = translateSnapshot(
      { ...emptyDraftState(), drafts: { r1: 'Hello world' } },
      { covered: [runTextSlot('r1')], sent, fromModel },
    )
    expect(translated?.drafts).toEqual({})
  })

  it('turns a pre-insert snapshot into a deletion of the stored paragraph', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [insertSlot('i1')],
      sent,
      fromModel,
      toModel: savedModel,
    })
    expect(translated?.inserts).toEqual([])
    expect(translated?.deletedParagraphIds).toEqual(['p3'])
  })

  it('turns a live-insert snapshot into a text override on the stored paragraph', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const translated = translateSnapshot(
      {
        ...emptyDraftState(),
        inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: '' }],
      },
      { covered: [insertSlot('i1')], sent, fromModel, toModel: savedModel },
    )
    expect(translated?.inserts).toEqual([])
    expect(translated?.drafts).toEqual({ r3: '' })
  })

  it('holds a structural reversal as a pending identity until the model loads', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const boundary = baseline({ covered: [insertSlot('i1')], sent })
    const translated = translateSnapshot(emptyDraftState(), boundary)
    const held = translated?.deletedParagraphIds[0] ?? ''
    expect(isPendingBaselineId(held)).toBe(true)

    // The planner neither sends nor blocks a pending identity.
    const plan = planDocumentSave(fromModel, translated ?? emptyDraftState())
    expect(plan.operations).toEqual([])
    expect(plan.blocked).toEqual([])
    expect(plan.pending).toBe(1)

    // The reloaded model names it, and the deletion becomes addressable.
    const resolved = resolveBaselineIdentities(
      translated ?? emptyDraftState(),
      { ...boundary, toModel: savedModel },
    )
    expect(resolved.deletedParagraphIds).toEqual(['p3'])
    expect(planDocumentSave(savedModel, resolved).operations).toEqual([
      { type: 'delete_paragraph', paragraphId: 'p3' },
    ])
  })

  it('rebuilds a saved deletion as an insert after its surviving neighbour', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['p2'],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [deleteSlot('p2')],
      sent,
      fromModel,
      toModel: model([{ id: 'p1', run: 'r1', text: 'Hello' }]),
    })
    expect(translated?.deletedParagraphIds).toEqual([])
    expect(translated?.inserts).toHaveLength(1)
    expect(translated?.inserts[0]?.afterParagraphId).toBe('p1')
    expect(translated?.inserts[0]?.text).toBe('tail')
  })

  it('drops the mask a snapshot already holds for a saved deletion', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['p2'],
    }
    const translated = translateSnapshot(
      { ...emptyDraftState(), deletedParagraphIds: ['p2'] },
      {
        covered: [deleteSlot('p2')],
        sent,
        fromModel,
        toModel: model([{ id: 'p1', run: 'r1', text: 'Hello' }]),
      },
    )
    expect(translated?.deletedParagraphIds).toEqual([])
    expect(translated?.inserts).toEqual([])
  })

  it('returns null when a saved deletion has no surviving anchor to restore after', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      deletedParagraphIds: ['p1'],
    }
    expect(
      translateSnapshot(emptyDraftState(), {
        covered: [deleteSlot('p1')],
        sent,
        fromModel,
        toModel: model([{ id: 'p2', run: 'r2', text: 'tail' }]),
      }),
    ).toBeNull()
  })

  it('never leaves a covered slot replayable after translation', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const snapshot: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
      inserts: [{ clientId: 'i1', afterParagraphId: 'p1', text: 'Second' }],
    }
    const translated = translateSnapshot(snapshot, {
      covered: [runTextSlot('r1'), insertSlot('i1')],
      sent,
      fromModel,
      toModel: savedModel,
    })
    const plan = planDocumentSave(savedModel, translated ?? emptyDraftState())
    expect(
      plan.operations.some(
        (operation) => operation.type === 'insert_paragraph_after',
      ),
    ).toBe(false)
  })
})

/**
 * The authoritative lineage is the identity source. These cases are the
 * reviewer's wrong-target reproduction in miniature: a mid-document insert
 * whose result positions shift cannot be resolved by an id set-difference, but
 * the server names the stored paragraph directly.
 */
describe('lineage-driven identity', () => {
  const baseModel = model([
    { id: 'para-000001', run: 'text-000001', text: 'Alpha' },
    { id: 'para-000002', run: 'text-000002', text: 'Beta' },
    { id: 'para-000003', run: 'text-000003', text: 'Gamma' },
  ])
  const resultModel = model([
    { id: 'para-w14-00000001', run: 'text-000001', text: 'Alpha' },
    { id: 'para-w14-00000002', run: 'text-000002', text: 'Inserted' },
    { id: 'para-w14-00000003', run: 'text-000003', text: 'Beta' },
    { id: 'para-w14-00000004', run: 'text-000004', text: 'Gamma' },
  ])
  const lineage: DocumentVersionLineage = {
    version: 1,
    baseVersionId: 'ver_1',
    versionId: 'ver_2',
    acceptedOperations: [0],
    paragraphs: [
      {
        fromParagraphId: 'para-000001',
        toParagraphId: 'para-w14-00000001',
        runs: [
          {
            runIndex: 0,
            segments: [
              { fromRunId: 'text-000001', fromOffset: 0, toOffset: 5 },
            ],
          },
        ],
      },
      {
        fromParagraphId: null,
        toParagraphId: 'para-w14-00000002',
        insertedByOperation: 0,
        runs: [
          {
            runIndex: 0,
            segments: [{ fromRunId: null, fromOffset: 0, toOffset: 0 }],
          },
        ],
      },
      {
        fromParagraphId: 'para-000002',
        toParagraphId: 'para-w14-00000003',
        runs: [
          {
            runIndex: 0,
            segments: [
              { fromRunId: 'text-000002', fromOffset: 0, toOffset: 4 },
            ],
          },
        ],
      },
      {
        fromParagraphId: 'para-000003',
        toParagraphId: 'para-w14-00000004',
        runs: [
          {
            runIndex: 0,
            segments: [
              { fromRunId: 'text-000003', fromOffset: 0, toOffset: 5 },
            ],
          },
        ],
      },
    ],
  }

  it('deletes the paragraph the save inserted, not the tail', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      inserts: [
        { clientId: 'c1', afterParagraphId: 'para-000001', text: 'Inserted' },
      ],
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [insertSlot('c1')],
      sent,
      fromModel: baseModel,
      toModel: resultModel,
      lineage,
      versionId: 'ver_2',
    })
    // The snapshot predates the insert, so its reversal deletes exactly the
    // stored paragraph. Gamma (para-000003) must not be touched.
    expect(translated?.deletedParagraphIds).toEqual(['para-w14-00000002'])
    expect(translated?.deletedParagraphIds).not.toContain('para-w14-00000004')
  })

  it('retargets a covered run-text reversal to the result run id', () => {
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { 'text-000003': 'Gamma edited' },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [runTextSlot('text-000003')],
      sent,
      fromModel: baseModel,
      toModel: resultModel,
      lineage,
      versionId: 'ver_2',
    })
    expect(translated?.drafts).toEqual({ 'text-000004': 'Gamma' })
  })
})
