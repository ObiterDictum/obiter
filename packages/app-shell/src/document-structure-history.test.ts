import '@obiter/test-dom'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
} from '@obiter/contracts'

import { useWorkspaceDraftHistory } from './document-editor-history'
import { translateSnapshot } from './document-history-baseline'
import {
  footnoteNoteParagraphId,
  type StructuralDraft,
} from './document-structural-drafts'
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

const imageDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'image',
  paragraphId,
  offset: 0,
  contentType: 'image/png',
  dataBase64: 'aGk=',
  widthPx: 4,
  heightPx: 4,
  name: 'x.png',
})

const linkDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'link',
  paragraphId,
  from: 0,
  to: 4,
  target: 'https://example.com',
})

const crossReferenceDraft = (
  id: string,
  paragraphId: string,
  targetParagraphId: string,
): StructuralDraft => ({
  id,
  kind: 'cross-reference',
  paragraphId,
  offset: 0,
  targetParagraphId,
})

const pageNumberDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'page-number',
  paragraphId,
  offset: 0,
})

const footnoteDraft = (id: string, paragraphId: string): StructuralDraft => ({
  id,
  kind: 'footnote',
  paragraphId,
  offset: 0,
})

const structureSlot = (draft: StructuralDraft): DraftSlot => ({
  kind: 'structure',
  key: `structure:${draft.id}`,
  id: draft.id,
  structureKind: draft.kind,
})

/** The save boundary one stored structure produces: its slot, its sent state. */
const structureBoundary = (draft: StructuralDraft) => ({
  covered: [structureSlot(draft)],
  sent: { ...emptyDraftState(), structures: [draft] },
  fromModel,
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
  comments: [],
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

  it('translates a snapshot predating a saved table', () => {
    // This test asserted `null` while the predating case was a per-kind
    // exception list: the block was itself the defect, because one refused
    // snapshot fails the whole boundary and blocks every later save. No
    // operation removes a stored table, so the predating state asks for
    // nothing it could express — the table is baseline content the restored
    // state stays consistent with, and undo simply has no removal to offer.
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [slot],
      sent,
      fromModel,
    })
    expect(translated).not.toBeNull()
    expect(translated?.structures).toEqual([])
  })

  it('translates a snapshot predating a saved picture', () => {
    // Same rule as the table: the vocabulary has no removal for a stored
    // drawing, so the snapshot survives instead of blocking the boundary.
    const image = imageDraft('s1', 'p1')
    const translated = translateSnapshot(
      emptyDraftState(),
      structureBoundary(image),
    )
    expect(translated).not.toBeNull()
    expect(translated?.structures).toEqual([])
  })

  it('translates a snapshot predating a saved cross-reference', () => {
    const reference = crossReferenceDraft('s1', 'p1', 'p2')
    const translated = translateSnapshot(
      emptyDraftState(),
      structureBoundary(reference),
    )
    expect(translated).not.toBeNull()
    expect(translated?.structures).toEqual([])
  })

  it('still blocks a snapshot predating a saved link', () => {
    // The one kind the vocabulary can remove: `set_hyperlink`'s nullable
    // target unwraps a stored link, so the pre-link state is expressible and
    // a boundary that does not emit that removal must not claim it.
    const link = linkDraft('s1', 'p1')
    expect(
      translateSnapshot(emptyDraftState(), structureBoundary(link)),
    ).toBeNull()
  })

  it('translates a snapshot predating a saved page-number field', () => {
    // One instance of the general rule: no operation removes a stored field
    // splice, so the page number stays baseline content — the predating
    // snapshot survives translation rather than blocking the whole boundary,
    // the same treatment a saved break gives it.
    const translated = translateSnapshot(
      emptyDraftState(),
      structureBoundary(pageNumberDraft('pn1', 'p1')),
    )
    expect(translated).not.toBeNull()
    expect(translated?.structures).toEqual([])
  })

  it('translates a snapshot predating a saved footnote', () => {
    // The same rule, with the covered list a real footnote save produces:
    // the structure slot and the deferred note-text runs, which the
    // predating snapshot does not hold. The reference and its note entry
    // stay baseline content and undo simply offers no removal.
    const noteParagraph = footnoteNoteParagraphId({ id: 'fn1' })
    const footnote = footnoteDraft('fn1', 'p1')
    const footnoteSent: DraftState = {
      ...emptyDraftState(),
      structures: [footnote],
      extraRuns: {
        [noteParagraph]: [
          {
            id: `${noteParagraph}-e`,
            text: 'note text',
            preservedXmlFragments: [],
          },
        ],
      },
    }
    const translated = translateSnapshot(emptyDraftState(), {
      covered: [
        structureSlot(footnote),
        {
          kind: 'extra-runs',
          key: `extra:${noteParagraph}`,
          paragraphId: noteParagraph,
        },
      ],
      sent: footnoteSent,
      fromModel,
    })
    expect(translated).not.toBeNull()
    expect(translated?.structures).toEqual([])
  })
})

describe('history stacks across a structure save', () => {
  it('reports unsupported and keeps every snapshot, including unrelated history', () => {
    const { result } = renderHook(() => useWorkspaceDraftHistory())
    // A link is the one structure kind whose predating snapshot still
    // blocks, so its boundary is what proves the translate stays
    // all-or-nothing: the older snapshot predates the link draft but
    // carries typed text; the newer holds the saved link as pending work.
    const link = linkDraft('s1', 'p1')
    const boundary = structureBoundary(link)
    const predating: DraftState = {
      ...emptyDraftState(),
      drafts: { 'p1-r': 'typed text' },
    }
    const holding: DraftState = {
      ...predating,
      structures: [link],
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
    // restores the link-holding snapshot, then the text-only one.
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
    const boundary = { covered: [slot], sent, fromModel }
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
