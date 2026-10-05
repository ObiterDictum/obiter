import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { useWorkspaceDraftHistory } from './document-editor-history'
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

describe('translateSnapshot structure slots', () => {
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

describe('history stacks across a structure save', () => {
  const boundary = { covered: [slot], sent, fromModel }

  it('reports unsupported and keeps every snapshot, including unrelated history', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    // The older snapshot predates the table draft but carries typed text;
    // the newer holds the saved table as pending work.
    const predating: DraftState = {
      ...emptyDraftState(),
      drafts: { 'p1-r': 'typed text' },
    }
    const holding: DraftState = {
      ...predating,
      structures: [tableDraft('s1', 'p1')],
    }
    act(() => result.current.record(predating))
    act(() => result.current.record(holding))

    const outcome: { value: { translated: boolean } | undefined } = {
      value: undefined,
    }
    act(() => {
      outcome.value = result.current.translate((snapshot) =>
        translateSnapshot(snapshot, boundary),
      )
    })
    expect(outcome.value?.translated).toBe(false)

    // Transactional: neither stack was rewritten or dropped. Undo still
    // restores the table-holding snapshot, then the text-only one.
    const captured: { value: DraftState | null } = { value: null }
    act(() => {
      captured.value = result.current.stepBack(emptyDraftState())
    })
    expect(captured.value?.structures).toHaveLength(1)
    expect(captured.value?.drafts).toEqual({ 'p1-r': 'typed text' })
    act(() => {
      captured.value = result.current.stepBack(emptyDraftState())
    })
    expect(captured.value?.drafts).toEqual({ 'p1-r': 'typed text' })
    expect(result.current.canUndo).toBe(false)
  })

  it('still rewrites the stacks when every snapshot translates', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    const holding: DraftState = {
      ...emptyDraftState(),
      drafts: { 'p1-r': 'typed text' },
      structures: [tableDraft('s1', 'p1')],
    }
    act(() => result.current.record(holding))

    const outcome: { value: { translated: boolean } | undefined } = {
      value: undefined,
    }
    act(() => {
      outcome.value = result.current.translate((snapshot) =>
        translateSnapshot(snapshot, boundary),
      )
    })
    expect(outcome.value?.translated).toBe(true)

    const captured: { value: DraftState | null } = { value: null }
    act(() => {
      captured.value = result.current.stepBack(emptyDraftState())
    })
    expect(captured.value?.structures).toEqual([])
    expect(captured.value?.drafts).toEqual({ 'p1-r': 'typed text' })
  })
})
