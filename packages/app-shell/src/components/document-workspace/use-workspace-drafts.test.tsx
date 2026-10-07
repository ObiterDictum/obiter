import '@obiter/test-dom'
import { useLayoutEffect } from 'react'
import { act, renderHook } from '@testing-library/react'
import { describe, expect, it } from 'bun:test'
import type {
  DocumentModelWire,
  DocumentParagraphWire,
  DocumentVersionLineage,
} from '@obiter/contracts'
import { emptyDraftState } from '../../document-save-plan'
import type { DraftSlot, DraftState } from '../../document-draft-state'
import type { WorkspaceDraftScope } from './document-workspace-draft-scope'
import {
  useWorkspaceDrafts,
  type WorkspaceDrafts,
} from './use-workspace-drafts'

/**
 * One stored paragraph `p1` with one run `r1`. The save-boundary fixture
 * addresses that run, which is all `lineageCoversCoveredSlots` asks for.
 */
function model(text: string): DocumentModelWire {
  const paragraph: DocumentParagraphWire = {
    id: 'p1',
    runs: [{ id: 'r1', text, preservedXmlFragments: [] }],
    preservedXmlFragments: [],
  }
  return {
    version: 1,
    stories: [
      {
        partName: 'word/document.xml',
        kind: 'document',
        paragraphs: [paragraph],
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

/** The run-map a server response carrying 'Hello' -> 'Hello world' describes. */
const SAVED_LINEAGE: DocumentVersionLineage = {
  version: 1,
  baseVersionId: 'ver_1',
  versionId: 'ver_2',
  acceptedOperations: [0],
  paragraphs: [
    {
      fromParagraphId: 'p1',
      toParagraphId: 'p1',
      runs: [
        {
          runIndex: 0,
          segments: [{ fromRunId: 'r1', fromOffset: 0, toOffset: 0 }],
        },
      ],
    },
  ],
}

function scopeFor(
  model: DocumentModelWire,
  versionId: string,
  versionNumber: number,
): WorkspaceDraftScope {
  return {
    organisationId: 'org_1',
    userId: 'usr_1',
    documentId: 'doc_1',
    baseVersionId: versionId,
    baseVersionNumber: versionNumber,
    model,
  }
}

/** One draft edit the test queues mid-commit; null when nothing is armed. */
type QueuedEdit = { current: Record<string, string> | null }

/**
 * Drives the real draft hook and injects one queued draft update from a
 * layout effect. A layout effect is the last point inside the model-swap
 * commit at which an input event can still land ahead of the pending passive
 * effects — the exact window a keystroke hits when the saved model paints
 * while the user is still typing. React guarantees those passive effects run
 * before the queued update is rendered, which is what a wholesale state
 * replacement would overwrite.
 */
function useDraftsWithQueuedEdit(
  scope: WorkspaceDraftScope,
  queued: QueuedEdit,
): WorkspaceDrafts {
  const drafts = useWorkspaceDrafts(scope)
  useLayoutEffect(() => {
    const edit = queued.current
    if (edit === null) return
    queued.current = null
    drafts.setDrafts((current) => ({ ...current, ...edit }))
  })
  return drafts
}

describe('draft edits queued across the save boundary', () => {
  it('keeps a draft edit queued while the saved model was being committed', () => {
    // The window a fast typer hits under load: the save has committed and the
    // saved model is painting, but the baseline-resolution effect has not run
    // yet. A keystroke queued in that gap is a pending update on the same
    // state the boundary rewrite replaces; resolving against the last
    // rendered state and writing it back wholesale discards that keystroke
    // silently — the draft state the next save is planned from simply lacks
    // the character.
    const queued: QueuedEdit = { current: null }
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) =>
        useDraftsWithQueuedEdit(scope, queued),
      { initialProps: { scope: scopeFor(model('Hello'), 'ver_1', 1) } },
    )

    // The saved request carried the run-text draft 'Hello world'.
    act(() => {
      result.current.setDrafts(() => ({ r1: 'Hello world' }))
    })
    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
    }
    const covered: DraftSlot[] = [
      { kind: 'run-text', key: 'run:r1', runId: 'r1' },
    ]
    act(() => {
      result.current.commitSaveBoundary(
        covered,
        sent,
        model('Hello'),
        SAVED_LINEAGE,
        'ver_2',
        2,
      )
    })
    expect(result.current.boundaryPending).toBe(true)
    expect(result.current.drafts).toEqual({})

    // The keystroke lands inside the saved-model commit: after the render, so
    // the state the boundary resolves against does not hold it, but ahead of
    // the baseline effect's rewrite.
    queued.current = { r1: 'Hello worldX' }
    rerender({ scope: scopeFor(model('Hello world'), 'ver_2', 2) })

    // The boundary resolved against the exact saved version, and the edit it
    // remapped is the live one — the queued keystroke survives the rewrite
    // instead of being dropped.
    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
    expect(result.current.drafts['r1']).toBe('Hello worldX')
  })

  it('resolves when the committed model renders before the boundary lands', () => {
    // The edit mutation's onSuccess finishes the model refetch before the
    // caller's `await mutateAsync` continues, so the saved version can paint
    // ahead of `commitSaveBoundary`. Recording the boundary re-runs the
    // resolution effect via its `pendingVersion` dependency; without that the
    // version match is never seen again and the save reports Saving forever.
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) => useWorkspaceDrafts(scope),
      { initialProps: { scope: scopeFor(model('Hello'), 'ver_1', 1) } },
    )

    act(() => {
      result.current.setDrafts(() => ({ r1: 'Hello world' }))
    })
    // The committed model renders before the boundary is recorded.
    rerender({ scope: scopeFor(model('Hello world'), 'ver_2', 2) })

    const sent: DraftState = {
      ...emptyDraftState(),
      drafts: { r1: 'Hello world' },
    }
    const covered: DraftSlot[] = [
      { kind: 'run-text', key: 'run:r1', runId: 'r1' },
    ]
    act(() => {
      result.current.commitSaveBoundary(
        covered,
        sent,
        model('Hello'),
        SAVED_LINEAGE,
        'ver_2',
        2,
      )
    })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
    expect(result.current.drafts).toEqual({})
  })
})
