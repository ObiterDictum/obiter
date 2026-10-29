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

type QueuedEdit = { current: Record<string, string> | null }

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
    const queued: QueuedEdit = { current: null }
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) =>
        useDraftsWithQueuedEdit(scope, queued),
      { initialProps: { scope: scopeFor(model('Hello'), 'ver_1', 1) } },
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
        model('Hello'),
        'ver_1',
        SAVED_LINEAGE,
        'ver_2',
        2,
      )
    })
    expect(result.current.boundaryPending).toBe(true)
    expect(result.current.drafts).toEqual({})

    queued.current = { r1: 'Hello worldX' }
    rerender({ scope: scopeFor(model('Hello world'), 'ver_2', 2) })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
    expect(result.current.drafts['r1']).toBe('Hello worldX')
  })

  it('resolves when the committed model renders before the boundary lands', () => {
    const { result, rerender } = renderHook(
      ({ scope }: { scope: WorkspaceDraftScope }) => useWorkspaceDrafts(scope),
      { initialProps: { scope: scopeFor(model('Hello'), 'ver_1', 1) } },
    )

    act(() => {
      result.current.setDrafts(() => ({ r1: 'Hello world' }))
    })
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

    rerender({ scope: scopeFor(shared, 'ver_2', 2) })

    expect(result.current.boundaryPending).toBe(false)
    expect(result.current.lineageUnresolved).toBe(false)
    expect(result.current.drafts).toEqual({})
  })

  it('blocks a newer version whose model projection is unchanged', () => {
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
