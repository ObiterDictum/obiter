import { useEffect, useRef, useState } from 'react'
import type { DocumentModelWire } from '@obiter/contracts'
import type { BreakDraft, LocalInsert } from '../../document-edits'
import type { StructuralDraft } from '../../document-structural-drafts'
import {
  adoptDocumentDraft,
  clearDocumentDraft,
  discardDocumentDrafts,
  discardRecoverableDraft,
  listRecoverableDocumentDrafts,
  readDocumentDraft,
  rememberDocumentDraftUser,
  resumeDocumentDraftWrites,
  writeDocumentDraft,
  type HeldChange,
  type RecoverableDraft,
} from '../../document-draft-store'
import { useWorkspaceDraftHistory } from '../../document-editor-history'
import {
  draftStorage,
  resolveDraftScope,
  sessionDraftStorage,
} from './document-draft-storage'
import { useDraftWriterClaim } from './use-draft-writer-claim'
import { useSaveBaseline, type BaselineBlockReason } from './use-save-baseline'
import type { FormatDrafts } from '../../document-format-edits'
import type { HistoryEdit } from '../../document-history-grouping'
import {
  clearableSlots,
  emptyDraftState,
  hasDraftState,
  removeDraftSlots,
  type DraftSlot,
  type DraftState,
} from '../../document-save-plan'
import type {
  DraftPersistence,
  WorkspaceDraftScope,
} from './document-workspace-draft-scope'
import { createWorkspaceDraftEdits } from './workspace-draft-edits'

export type WorkspaceDrafts = ReturnType<typeof useWorkspaceDrafts>

/** Live drafts plus held changes restored from older snapshots. */
type DraftBundle = { state: DraftState; held: HeldChange[] }

export function useWorkspaceDrafts(scope: WorkspaceDraftScope) {
  const [bundle, setBundle] = useState<DraftBundle>({
    state: emptyDraftState(),
    held: [],
  })
  const history = useWorkspaceDraftHistory()
  const [persistence, setPersistence] = useState<DraftPersistence>('ok')
  const [restored, setRestored] = useState(false)
  const [blockedReason, setBlockedReason] =
    useState<BaselineBlockReason | null>(null)
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
  const baseline = useSaveBaseline({
    history,
    model: scope.model,
    modelVersionId: scope.baseVersionId,
    modelVersionNumber: scope.baseVersionNumber,
    modelError: scope.modelError ?? false,
    state: bundle.state,
    resolveState: (update) =>
      setBundle((current) => ({ ...current, state: update(current.state) })),
    onBlocked: setBlockedReason,
  })
  const storage = draftStorage()
  const session = sessionDraftStorage()
  const storedScope = () =>
    resolveDraftScope(scope, session, storage, instanceId.current)
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
  useDraftWriterClaim({
    storage,
    documentId: scope.documentId,
    writerId: () => storedScope().tabId,
    instanceId: instanceId.current,
  })
  function checkpoint(edit?: HistoryEdit) {
    // Recording ends the redo branch: a new edit supersedes anything undone.
    history.record(bundleRef.current.state, edit)
  }

  /**
   * Advances the history baseline after a successful save. The covered slots
   * are cleared from live state, and every history snapshot is re-expressed
   * against the saved document: undo now reverses a saved edit instead of
   * replaying it as fresh work.
   */
  function commitSaveBoundary(
    covered: readonly DraftSlot[],
    sent: DraftState,
    fromModel: DocumentModelWire,
    fromVersionId: string | undefined,
    lineage?: import('@obiter/contracts').DocumentVersionLineage,
    versionId?: string,
    versionNumber?: number,
  ) {
    clearSlots(covered, sent)
    const { resolved, reason } = baseline.commit(
      covered,
      sent,
      fromModel,
      fromVersionId,
      lineage,
      versionId,
      versionNumber,
    )
    setBlockedReason(resolved ? null : (reason ?? 'lineage'))
  }
  function resetHistoryAfterDecision(id?: string, version?: number) {
    history.clear()
    baseline.clear()
    setBlockedReason(null)
    if (id) baseline.markDecisionCommitted(id, version)
  }
  function resetDrafts() {
    setBundle({ state: emptyDraftState(), held: [] })
    history.clear()
    baseline.clear()
    setRestored(false)
    setStaleDraft(null)
    setRecoverable([])
    setBlockedReason(null)
  }
  function setState(update: (current: DraftState) => DraftState) {
    setBundle((current) => ({ ...current, state: update(current.state) }))
  }

  // The editor operations live in their own module; they read the latest state
  // and history checkpoint through these seams.
  const edits = createWorkspaceDraftEdits({
    getModel: () => scope.model,
    getState: () => bundleRef.current.state,
    setState,
    checkpoint,
  })

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
    // The adopted draft was recorded against another version, so the history
    // taken against this one cannot be replayed over it.
    history.clear()
    baseline.clear()
    setBlockedReason(null)
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
    const snapshot = history.stepBack(bundle.state)
    if (!snapshot) return null
    setState(() => snapshot)
    return snapshot
  }

  function redoDraft() {
    const snapshot = history.stepForward(bundle.state)
    if (!snapshot) return null
    setState(() => snapshot)
    return snapshot
  }

  /** The one history-checkpointed field update format, breaks and structures
   * share: an unchanged field keeps the bundle's identity so no history step
   * or re-render pays for a no-op write. */
  function setField<K extends 'format' | 'breaks' | 'structures'>(
    key: K,
    update: (current: DraftState[K]) => DraftState[K],
  ) {
    setBundle((current) => {
      const next = update(current.state[key])
      if (next === current.state[key]) return current
      history.record(current.state)
      return { ...current, state: { ...current.state, [key]: next } }
    })
  }
  const setFormat = (update: (current: FormatDrafts) => FormatDrafts) =>
    setField('format', update)
  const setBreaks = (update: (current: BreakDraft[]) => BreakDraft[]) =>
    setField('breaks', update)
  const setStructures = (
    update: (current: StructuralDraft[]) => StructuralDraft[],
  ) => setField('structures', update)

  return {
    state: bundle.state,
    drafts: bundle.state.drafts,
    inserts: bundle.state.inserts,
    deletedParagraphIds: bundle.state.deletedParagraphIds,
    extraRuns: bundle.state.extraRuns,
    format: bundle.state.format,
    breaks: bundle.state.breaks,
    structures: bundle.state.structures,
    latestState: () => bundleRef.current.state,
    setDrafts: (
      update: (current: Record<string, string>) => Record<string, string>,
    ) =>
      setState((current) => ({ ...current, drafts: update(current.drafts) })),
    setInserts: (update: (current: LocalInsert[]) => LocalInsert[]) =>
      setState((current) => ({ ...current, inserts: update(current.inserts) })),
    setFormat,
    setBreaks,
    setStructures,
    resetDrafts,
    clearSlots,
    commitSaveBoundary,
    resetHistoryAfterDecision,
    held: bundle.held,
    discardHeld,
    persistence,
    restored,
    lineageUnresolved: blockedReason !== null,
    blockedReason,
    paragraphRemap: baseline.paragraphRemap,
    boundaryPending: baseline.pendingVersion !== null,
    markDecisionCommitted: baseline.markDecisionCommitted,
    staleDraft,
    discardStaleDraft,
    recoverable,
    restoreRecoverable,
    discardRecoverable,
    undoDraft,
    redoDraft,
    ...edits,
    canUndo: history.canUndo && blockedReason === null,
    canRedo: history.canRedo && blockedReason === null,
  }
}
