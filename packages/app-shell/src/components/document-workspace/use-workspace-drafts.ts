import { useEffect, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import { removeInsert, type LocalInsert } from '../../document-edits'
import {
  clearDocumentDraft,
  discardDocumentDrafts,
  documentDraftTabId,
  readDocumentDraft,
  writeDocumentDraft,
  type DraftScope,
  type DraftStorage,
  type HeldChange,
} from '../../document-draft-store'
import {
  popWorkspaceDraft,
  pushWorkspaceDraft,
  type WorkspaceDraftSnapshot,
} from '../../document-editor-history'
import type { FormatDrafts } from '../../document-format-edits'
import {
  applyInsertText,
  applyWordEdit,
  replaceFindHits,
  type EditorResult,
} from '../../document-word-edits'
import {
  clearableSlots,
  emptyDraftState,
  hasDraftState,
  removeDraftSlots,
  splitDraftSlots,
  type DraftSlot,
  type DraftState,
} from '../../document-save-plan'
import type { ParagraphWordEdit } from './model-paragraph'

export type WorkspaceDraftScope = {
  organisationId: string
  userId: string
  documentId: string
  /** Stored version the workspace opened at; undefined until the model loads. */
  baseVersionId: string | undefined
}

export type DraftPersistence = 'ok' | 'unavailable'

export type WorkspaceDrafts = ReturnType<typeof useWorkspaceDrafts>

export function useWorkspaceDrafts(scope: WorkspaceDraftScope) {
  const [state, setState] = useState<DraftState>(emptyDraftState)
  const [past, setPast] = useState<WorkspaceDraftSnapshot[]>([])
  const [held, setHeld] = useState<HeldChange[]>([])
  const [persistence, setPersistence] = useState<DraftPersistence>('ok')
  const [restored, setRestored] = useState(false)
  const [staleDraft, setStaleDraft] = useState<string | null>(null)
  // Drafts are only read, written or cleared once the version they were
  // recorded against is known and the stored draft has been applied, so a
  // pre-restore render cannot clear the draft it is about to load.
  const [hydrated, setHydrated] = useState(false)

  const storage = draftStorage()

  function storedScope(): DraftScope {
    return { ...scope, tabId: documentDraftTabId(sessionDraftStorage()) }
  }

  useEffect(() => {
    if (hydrated) return
    if (!scope.baseVersionId) return
    if (!storage) {
      setPersistence('unavailable')
      setHydrated(true)
      return
    }
    const result = readDocumentDraft(
      storage,
      storedScope(),
      scope.baseVersionId,
    )
    if (result.status === 'unavailable') setPersistence('unavailable')
    else if (result.status === 'stale') setStaleDraft(result.baseVersionId)
    else if (result.status === 'restored') {
      setState(result.state)
      setHeld(result.held)
      setRestored(true)
    }
    setHydrated(true)
    // `scope` identity is stable for the mount: DocumentWorkspace keys this
    // workspace on documentId, so organisation, user and document cannot change
    // underneath the effects.
  }, [scope.baseVersionId, storage, hydrated])

  useEffect(() => {
    if (!hydrated || !storage || !scope.baseVersionId) return
    // A parked draft for another version stays until the user discards it; this
    // effect owns only the active key.
    if (!hasDraftState(state) && held.length === 0) {
      clearDocumentDraft(storage, storedScope())
      return
    }
    const ok = writeDocumentDraft(storage, storedScope(), {
      baseVersionId: scope.baseVersionId,
      state,
      held,
    })
    setPersistence(ok ? 'ok' : 'unavailable')
    // storedScope resolves a tab id from sessionStorage and is stable per tab.
  }, [state, held, scope.baseVersionId, storage, hydrated])

  function checkpoint() {
    setPast((current) => pushWorkspaceDraft(current, state))
  }

  function resetDrafts() {
    setState(emptyDraftState())
    setPast([])
    setHeld([])
    setRestored(false)
    setStaleDraft(null)
  }

  /**
   * Clears the slots a successful request covered, leaving anything held back
   * (blocked or previously rejected) in place. `sent` is the state the request
   * was planned from: a slot edited while it was in flight is kept, because the
   * request did not carry that edit. E45: a save must not report work saved
   * that it did not send, and must not discard work it did not send.
   */
  function clearSlots(slots: readonly DraftSlot[], sent?: DraftState) {
    if (slots.length === 0) return
    setState((current) =>
      removeDraftSlots(
        current,
        sent ? clearableSlots(slots, sent, current) : slots,
      ),
    )
  }

  /**
   * Moves a slot the server rejected out of the draft state and into a held
   * change, so the next save cannot resend it and the user can still see and
   * discard it. Content is preserved, never silently dropped.
   */
  function holdSlot(
    slot: DraftSlot,
    label: string,
    reason: string,
  ): HeldChange | null {
    const { remaining, removed } = splitDraftSlots(state, [slot])
    if (!hasDraftState(removed)) return null
    const record: HeldChange = {
      id: crypto.randomUUID(),
      label,
      reason,
      createdAt: new Date().toISOString(),
      state: removed,
    }
    setState(remaining)
    setHeld((current) => [...current, record])
    return record
  }

  function discardHeld(ids: readonly string[]) {
    const drop = new Set(ids)
    setHeld((current) => current.filter((item) => !drop.has(item.id)))
  }

  function discardStaleDraft() {
    setStaleDraft(null)
    if (storage) discardDocumentDrafts(storage, storedScope())
  }

  function undoDraft() {
    const popped = popWorkspaceDraft(past)
    if (!popped) return null
    setPast(popped.history)
    setState(popped.snapshot)
    return popped.snapshot
  }

  function commitEditor(result: EditorResult) {
    setState((current) => ({
      ...current,
      drafts: result.state.drafts,
      inserts: result.state.inserts,
      deletedParagraphIds: result.state.deletedParagraphIds,
      extraRuns: result.state.extraRuns,
    }))
  }

  function handleWordEdit(
    model: DocumentModelWire,
    edit: ParagraphWordEdit,
  ): { paragraphId: string; offset: number } | null {
    const result = applyWordEdit(model, state, edit, crypto.randomUUID())
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function replaceHits(
    model: DocumentModelWire,
    hits: ReadonlyArray<{ paragraphId: string; start: number; end: number }>,
    replacement: string,
    which: number | 'all',
  ) {
    const result = replaceFindHits(model, state, hits, replacement, which)
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function insertText(
    model: DocumentModelWire,
    paragraphId: string,
    offset: number,
    text: string,
  ) {
    const result = applyInsertText(model, state, { paragraphId, offset }, text)
    if (!result) return null
    checkpoint()
    commitEditor(result)
    return result.caret
  }

  function insertAfter(afterParagraphId: string) {
    checkpoint()
    const clientId = crypto.randomUUID()
    setState((current) => ({
      ...current,
      inserts: [...current.inserts, { clientId, afterParagraphId, text: '' }],
    }))
    return clientId
  }

  function deleteParagraph(paragraphId: string) {
    const removed = removeInsert(state.inserts, paragraphId)
    if (removed) {
      checkpoint()
      setState((current) => ({ ...current, inserts: removed.inserts }))
      return removed.selectId
    }
    // Deleting an already-deleted paragraph is a no-op; do not pollute
    // history with a checkpoint that matches its successor.
    if (state.deletedParagraphIds.includes(paragraphId)) return null
    checkpoint()
    setState((current) => ({
      ...current,
      deletedParagraphIds: [...current.deletedParagraphIds, paragraphId],
    }))
    return null
  }

  function setFormat(update: (current: FormatDrafts) => FormatDrafts) {
    setState((current) => {
      const next = update(current.format)
      // Updaters that return the same instance mean a no-op (e.g. indent on a
      // non-list paragraph); do not checkpoint a state identical to its
      // successor.
      if (next === current.format) return current
      setPast((history) => pushWorkspaceDraft(history, current))
      return { ...current, format: next }
    })
  }

  return {
    state,
    drafts: state.drafts,
    inserts: state.inserts,
    deletedParagraphIds: state.deletedParagraphIds,
    extraRuns: state.extraRuns,
    format: state.format,
    setDrafts: (
      update: (current: Record<string, string>) => Record<string, string>,
    ) =>
      setState((current) => ({ ...current, drafts: update(current.drafts) })),
    setInserts: (update: (current: LocalInsert[]) => LocalInsert[]) =>
      setState((current) => ({ ...current, inserts: update(current.inserts) })),
    setFormat,
    resetDrafts,
    clearSlots,
    holdSlot,
    held,
    discardHeld,
    persistence,
    restored,
    staleDraft,
    discardStaleDraft,
    undoDraft,
    handleWordEdit,
    replaceHits,
    insertText,
    insertAfter,
    deleteParagraph,
    canUndo: past.length > 0,
  }
}

function draftStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

function sessionDraftStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}
