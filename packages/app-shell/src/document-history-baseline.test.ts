import { describe, expect, it } from 'bun:test'
import type { DocumentModelWire } from '@obiter/contracts'
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
