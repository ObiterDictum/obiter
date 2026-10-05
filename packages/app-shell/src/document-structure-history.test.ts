import '@obiter/test-dom'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { translateSnapshot } from './document-history-baseline'
import type { StructuralDraft } from './document-structural-drafts'
import {
  emptyDraftState,
  type DraftSlot,
  type DraftState,
} from './document-save-plan'

const tableDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'table',
  paragraphId,
  rows: 2,
  columns: 2,
})

const paragraph = (id: string, text = 'text'): DocumentParagraphWire => ({
  id,
  runs: [{ id: `${id}-r`, text, preservedXmlFragments: [] }],
  preservedXmlFragments: [],
})

const model = (paragraphs: DocumentParagraphWire[]): DocumentModelWire => ({
  version: 1,
  stories: [
    {
      partName: 'word/document.xml',
      kind: 'document',
      paragraphs,
      preservedXmlFragments: [],
    },
  ],
  styles: [],
  numbering: [],
  relationships: [],
  preservedXmlFragments: [],
  changes: [],
})

describe('translateSnapshot structure slots', () => {
  const fromModel = model([paragraph('p1')])
  const slot: DraftSlot = {
    kind: 'structure',
    key: 'structure:s1',
    id: 's1',
    structureKind: 'table',
  }
  const sent: DraftState = {
    ...emptyDraftState(),
    structures: [tableDraft('s1', 'p1')],
  }

  it('translates a snapshot holding the saved structure, keeping its text', () => {
    const snapshot: DraftState = {
      ...sent,
      drafts: { 'p1-r': 'typed elsewhere' },
    }
    const translated = translateSnapshot(snapshot, {
      covered: [slot],
      sent,
      fromModel,
    })
    // The table is on disk now, so its pending slot clears — but the
    // unrelated typed draft rides through instead of dying with the snapshot.
    expect(translated).not.toBeNull()
    expect(translated?.structures).toEqual([])
    expect(translated?.drafts).toEqual({ 'p1-r': 'typed elsewhere' })
  })

  it('marks a snapshot predating the structure as explicitly unsupported', () => {
    // Restoring it would need a delete-table operation that does not exist.
    expect(
      translateSnapshot(emptyDraftState(), {
        covered: [slot],
        sent,
        fromModel,
      }),
    ).toBeNull()
  })
})
