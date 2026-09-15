import { useEffect, useRef, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import { removeInsert, type LocalInsert } from '../../document-edits'
import {
  adoptDocumentDraft,
  clearDocumentDraft,
  discardDocumentDrafts,
  discardRecoverableDraft,
  listRecoverableDocumentDrafts,
  readDocumentDraft,
  rememberDocumentDraftUser,
  releaseDocumentDraftWriterClaim,
  resolveDocumentDraftWriter,
  resumeDocumentDraftWrites,
  touchDocumentDraftWriterClaim,
  writeDocumentDraft,
  type DraftScope,
  type DraftStorage,
  type HeldChange,
  type RecoverableDraft,
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

type DraftBundle = {
  state: DraftState
  held: HeldChange[]
}

export function useWorkspaceDrafts(scope: WorkspaceDraftScope) {
  const [bundle, setBundle] = useState<DraftBundle>({
    state: emptyDraftState(),
    held: [],
  })
  const [past, setPast] = useState<WorkspaceDraftSnapshot[]>([])
  const [persistence, setPersistence] = useState<DraftPersistence>('ok')
  const [restored, setRestored] = useState(false)
  const [staleDraft, setStaleDraft] = useState<string | null>(null)
  const [recoverable, setRecoverable] = useState<RecoverableDraft[]>([])
  const [hydrated, setHydrated] = useState(false)
  const instanceId = useRef(
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${String(Date.now())}-${String(Math.random())}`,
  )
  const bundleRef = useRef(bundle)
  bundleRef.current = bundle

  const storage = draftStorage()
  const session = sessionDraftStorage()

  function storedScope(): DraftScope {
    return {
      ...scope,
      tabId: resolveDocumentDraftWriter(session, storage, instanceId.current),
    }
  }

  useEffect(() => {
    if (scope.userId && scope.userId !== 'anonymous') {
      resumeDocumentDraftWrites()
      rememberDocumentDraftUser(scope.userId)
    }
  }, [scope.userId])

  useEffect(() => {
    if (hydrated) return
    if (!scope.baseVersionId) return
    if (!storage) {
      setPersistence('unavailable')
      setHydrated(true)
      return
    }
    const writer = storedScope()
    const result = readDocumentDraft(storage, writer, scope.baseVersionId)
    const extras = listRecoverableDocumentDrafts(
      storage,
      writer,
      result.status === 'restored' ? result.draftId : undefined,
    )
    if (result.status === 'unavailable') setPersistence('unavailable')
    else if (result.status === 'choice') {
      setRecoverable(result.drafts)
    } else if (result.status === 'stale') {
      setStaleDraft(result.baseVersionId)
      setRecoverable(extras)
    } else if (result.status === 'restored') {
      setBundle({ state: result.state, held: result.held })
      setRestored(true)
      setRecoverable(extras)
      if (extras.some((item) => item.status === 'parked')) {
        setStaleDraft(
          extras.find((item) => item.status === 'parked')?.baseVersionId ??
            null,
        )
      }
    } else {
      setRecoverable(extras)
      const parked = extras.find((item) => item.status === 'parked')
      if (parked) setStaleDraft(parked.baseVersionId)
    }
    setHydrated(true)
    // `scope` identity is stable for the mount: DocumentWorkspace keys this
    // workspace on documentId, so organisation, user and document cannot change
    // underneath the effects.
  }, [scope.baseVersionId, storage, hydrated])

  useEffect(() => {
    if (!hydrated || !storage || !scope.baseVersionId) return
    const writer = storedScope()
    if (!hasDraftState(bundle.state) && bundle.held.length === 0) {
      clearDocumentDraft(storage, writer)
      return
    }
    const ok = writeDocumentDraft(storage, writer, {
      baseVersionId: scope.baseVersionId,
      state: bundle.state,
      held: bundle.held,
    })
    setPersistence(ok ? 'ok' : 'unavailable')
  }, [bundle, scope.baseVersionId, storage, hydrated])

  useEffect(() => {
    if (!storage) return
    const writerId = storedScope().tabId
    const tick = () =>
      touchDocumentDraftWriterClaim(storage, writerId, instanceId.current)
    tick()
    const timer = window.setInterval(tick, 1000)
    const release = () =>
      releaseDocumentDraftWriterClaim(storage, writerId, instanceId.current)
    window.addEventListener('pagehide', release)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('pagehide', release)
      release()
    }
  }, [storage, scope.documentId])

  function checkpoint() {
    setPast((current) => pushWorkspaceDraft(current, bundle.state))
  }

  function resetDrafts() {
    setBundle({ state: emptyDraftState(), held: [] })
    setPast([])
    setRestored(false)
    setStaleDraft(null)
    setRecoverable([])
  }

  function setState(update: (current: DraftState) => DraftState) {
    setBundle((current) => ({ ...current, state: update(current.state) }))
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
    setBundle((current) => ({
      ...current,
      state: removeDraftSlots(
        current.state,
        sent ? clearableSlots(slots, sent, current.state) : slots,
      ),
    }))
  }

  /**
   * Moves a slot the server rejected out of the draft state and into a held
   * change, so the next save cannot resend it and the user can still see and
   * discard it. Content is preserved, never silently dropped. The split always
   * reads the latest bundle so typing during a request is not overwritten.
   *
   * When `sent` (the state the rejected request was planned from) is given
   * and the slot changed after planning, the held record keeps the sent
   * content while the newer typing stays editable: holding the slot's latest
   * content would swallow text the rejection never saw, stranding it in held
   * limbo with no reapply path. The next save may re-send that newer text and
   * be rejected again, which then holds it cleanly; that round trip costs a
   * request, silently eating the typing would cost the work.
   */
  function holdSlot(
    slot: DraftSlot,
    label: string,
    reason: string,
    sent?: DraftState,
  ): HeldChange | null {
    const record: HeldChange = {
      id: crypto.randomUUID(),
      label,
      reason,
      createdAt: new Date().toISOString(),
      state: emptyDraftState(),
    }
    setBundle((current) => {
      const base = sent ?? current.state
      const { removed } = splitDraftSlots(base, [slot])
      if (!hasDraftState(removed)) return current
      record.state = removed
      if (sent && clearableSlots([slot], sent, current.state).length === 0) {
        return { state: current.state, held: [...current.held, record] }
      }
      const { remaining } = splitDraftSlots(current.state, [slot])
      return {
        state: remaining,
        held: [...current.held, record],
      }
    })
    return record
  }

  function discardHeld(ids: readonly string[]) {
    const drop = new Set(ids)
    setBundle((current) => ({
      ...current,
      held: current.held.filter((item) => !drop.has(item.id)),
    }))
  }

  function discardStaleDraft() {
    setStaleDraft(null)
    setRecoverable((current) =>
      current.filter((item) => item.status !== 'parked'),
    )
    if (storage) discardDocumentDrafts(storage, storedScope())
  }

  function restoreRecoverable(draftId: string) {
    if (!storage || !scope.baseVersionId) return
    const result = adoptDocumentDraft(storage, storedScope(), draftId)
    if (result.status !== 'restored') return
    setBundle({ state: result.state, held: result.held })
    setRestored(true)
    setRecoverable((current) =>
      current.filter((item) => item.draftId !== draftId),
    )
  }

  function discardRecoverable(draftId: string) {
    if (storage) discardRecoverableDraft(storage, scope, draftId)
    setRecoverable((current) =>
      current.filter((item) => item.draftId !== draftId),
    )
  }

  function undoDraft() {
    const popped = popWorkspaceDraft(past)
    if (!popped) return null
    setPast(popped.history)
    setState(() => popped.snapshot)
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
    const result = applyWordEdit(model, bundle.state, edit, crypto.randomUUID())
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
    const result = replaceFindHits(
      model,
      bundle.state,
      hits,
      replacement,
      which,
    )
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
    const result = applyInsertText(
      model,
      bundle.state,
      { paragraphId, offset },
      text,
    )
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
    const removed = removeInsert(bundle.state.inserts, paragraphId)
    if (removed) {
      checkpoint()
      setState((current) => ({ ...current, inserts: removed.inserts }))
      return removed.selectId
    }
    if (bundle.state.deletedParagraphIds.includes(paragraphId)) return null
    checkpoint()
    setState((current) => ({
      ...current,
      deletedParagraphIds: [...current.deletedParagraphIds, paragraphId],
    }))
    return null
  }

  function setFormat(update: (current: FormatDrafts) => FormatDrafts) {
    setBundle((current) => {
      const next = update(current.state.format)
      if (next === current.state.format) return current
      setPast((history) => pushWorkspaceDraft(history, current.state))
      return { ...current, state: { ...current.state, format: next } }
    })
  }

  return {
    state: bundle.state,
    drafts: bundle.state.drafts,
    inserts: bundle.state.inserts,
    deletedParagraphIds: bundle.state.deletedParagraphIds,
    extraRuns: bundle.state.extraRuns,
    format: bundle.state.format,
    latestState: () => bundleRef.current.state,
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
    held: bundle.held,
    discardHeld,
    persistence,
    restored,
    staleDraft,
    discardStaleDraft,
    recoverable,
    restoreRecoverable,
    discardRecoverable,
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
