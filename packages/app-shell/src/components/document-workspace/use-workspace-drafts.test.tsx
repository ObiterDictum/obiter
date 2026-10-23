import '@obiter/test-dom'
import { createElement, useLayoutEffect, type PropsWithChildren } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { vi } from '../../../../../scripts/test/vitest-compat'
import { listDocumentDrafts } from '../../document-draft-store'
import { useDocumentSave } from './use-document-save'
import { act, renderHook, waitFor } from '@testing-library/react'
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
        fields: [],
        unanchoredFieldParagraphIds: [],
      },
    ],
    styles: [],
    numbering: [],
    relationships: [],
    preservedXmlFragments: [],
    changes: [],
    comments: [],
    trackRevisions: false,
    markings: {
      documentKind: null,
      draft: false,
      privileged: false,
      withoutPrejudice: false,
    },
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
        'ver_1',
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
        'ver_1',
        SAVED_LINEAGE,
        'ver_2',
        2,
      )
    })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
    expect(result.current.drafts).toEqual({})
  })

  it('resolves a committed version whose model projection is unchanged', () => {
    // An operation can commit a version whose parsed model is deep-equal to
    // the pre-save one — e.g. one that only touches XML the parser drops.
    // Structural sharing then keeps `model` referentially identical, so a
    // same-model check reads the committed version as the pre-save rerun and
    // the boundary never resolves: Saving forever. The version id is the
    // identity that decides.
    const shared = model('Hello')
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) => useWorkspaceDrafts(scope),
      { initialProps: { scope: scopeFor(shared, 'ver_1', 1) } },
    )

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
        shared,
        'ver_1',
        SAVED_LINEAGE,
        'ver_2',
        2,
      )
    })
    expect(result.current.boundaryPending).toBe(true)

    // The committed version arrives carrying the same model reference.
    rerender({ scope: scopeFor(shared, 'ver_2', 2) })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
    expect(result.current.drafts).toEqual({})
  })

  it('blocks a newer version whose model projection is unchanged', () => {
    // The sibling case: a version the save did not produce arrives with a
    // deep-equal model. Waiting on it would wedge the same way, so the
    // boundary must block honestly instead.
    const shared = model('Hello')
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) => useWorkspaceDrafts(scope),
      { initialProps: { scope: scopeFor(shared, 'ver_1', 1) } },
    )

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
        shared,
        'ver_1',
        SAVED_LINEAGE,
        'ver_2',
        2,
      )
    })
    expect(result.current.boundaryPending).toBe(true)

    rerender({ scope: scopeFor(shared, 'ver_3', 3) })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(true)
    expect(result.current.blockedReason).toBe('newer-version')
  })

  it('resolves a committed decision whose model projection is unchanged', () => {
    // The tracked-decision path waits on the same gate with no lineage: the
    // decision's version arriving under the same model reference must still
    // release the boundary.
    const shared = model('Hello')
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) => useWorkspaceDrafts(scope),
      { initialProps: { scope: scopeFor(shared, 'ver_1', 1) } },
    )

    act(() => {
      result.current.resetHistoryAfterDecision('ver_2', 2)
    })
    expect(result.current.boundaryPending).toBe(true)

    rerender({ scope: scopeFor(shared, 'ver_2', 2) })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
  })
})

it('retires saved text and track-changes intent before query refresh finishes', async () => {
  window.localStorage.clear()
  window.sessionStorage.clear()
  const scope = scopeFor(model('Hello'), 'ver_1', 1)
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  })
  let finishRefresh: () => void = () => undefined
  const refresh = new Promise<void>((resolve) => {
    finishRefresh = resolve
  })
  let draftsAtRefresh: ReturnType<typeof listDocumentDrafts> | undefined
  const invalidate = vi
    .spyOn(client, 'invalidateQueries')
    .mockImplementation(() => {
      draftsAtRefresh = listDocumentDrafts(window.localStorage, scope)
      return refresh
    })
  const network = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    Response.json(
      {
        documentId: 'doc_1',
        versionId: 'ver_2',
        versionNumber: 2,
        lineage: SAVED_LINEAGE,
      },
      { status: 201 },
    ),
  )
  function wrapper({ children }: PropsWithChildren) {
    return createElement(QueryClientProvider, { client }, children)
  }
  const mounted = renderHook(
    () => {
      const drafts = useWorkspaceDrafts(scope)
      const save = useDocumentSave({
        documentId: 'doc_1',
        matterId: 'mtr_1',
        model: scope.model,
        drafts,
        baseVersionId: 'ver_1',
        trackChanges: drafts.trackChangesFlip ?? false,
        presence: [],
        currentUserId: 'usr_1',
        remoteChange: false,
        onSaved: () => undefined,
      })
      return { drafts, save }
    },
    { wrapper },
  )
  try {
    act(() => {
      mounted.result.current.drafts.setDrafts(() => ({ r1: 'Hello saved' }))
      mounted.result.current.drafts.setTrackChangesFlip(true)
    })
    expect(listDocumentDrafts(window.localStorage, scope)).toHaveLength(1)
    act(() => mounted.result.current.save.save())
    await waitFor(() => expect(invalidate).toHaveBeenCalled())
    expect(JSON.parse(String(network.mock.calls[0]?.[1]?.body))).toMatchObject({
      trackChanges: true,
      operations: [
        { type: 'replace_run_text', runId: 'r1', text: 'Hello saved' },
      ],
    })
    // The POST succeeded, but every refreshed query is still pending.
    expect(draftsAtRefresh).toEqual([])
    expect(listDocumentDrafts(window.localStorage, scope)).toEqual([])
    mounted.unmount()
    const reopened = renderHook(() =>
      useWorkspaceDrafts(
        scopeFor({ ...model('Hello saved'), trackRevisions: true }, 'ver_2', 2),
      ),
    )
    expect(reopened.result.current.staleDraft).toBeNull()
    expect(reopened.result.current.drafts).toEqual({})
    reopened.unmount()
  } finally {
    finishRefresh()
    await act(async () => {
      await refresh
    })
    mounted.unmount()
    invalidate.mockRestore()
    network.mockRestore()
    client.clear()
  }
})
