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

type DraftBundle = {
  state: DraftState
  held: HeldChange[]
  trackChangesFlip?: boolean
}

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
  const committedToggle = useRef<boolean | undefined>(undefined)
  const acknowledgedSlots = useRef<{
    covered: readonly DraftSlot[]
    sent: DraftState
  } | null>(null)
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
  if (scope.model?.trackRevisions === committedToggle.current) {
    committedToggle.current = undefined
  }
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
      setBundle({
        state: result.state,
        held: result.held,
        ...(result.trackChangesFlip !== undefined
          ? { trackChangesFlip: result.trackChangesFlip }
          : {}),
      })
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

  function persistBundle(next: DraftBundle) {
    if (!hydrated || !storage || !scope.baseVersionId) return
    const writer = storedScope()
    const acknowledged = acknowledgedSlots.current
    if (acknowledged) {
      const slots = clearableSlots(
        acknowledged.covered,
        acknowledged.sent,
        next.state,
      )
      next = { ...next, state: removeDraftSlots(next.state, slots) }
      if (slots.length === 0) acknowledgedSlots.current = null
    }
    const flipPending =
      next.trackChangesFlip !== undefined &&
      next.trackChangesFlip !==
        (committedToggle.current ?? scope.model?.trackRevisions)
    if (!hasDraftState(next.state) && next.held.length === 0 && !flipPending) {
      clearDocumentDraft(storage, writer)
      return
    }
    const ok = writeDocumentDraft(storage, writer, {
      baseVersionId: scope.baseVersionId,
      state: next.state,
      held: next.held,
      ...(flipPending ? { trackChangesFlip: next.trackChangesFlip } : {}),
    })
    setPersistence(ok ? 'ok' : 'unavailable')
  }

  useEffect(() => {
    persistBundle(bundle)
  }, [
    bundle,
    scope.baseVersionId,
    scope.model?.trackRevisions,
    storage,
    hydrated,
  ])

  function acknowledgeSave(
    covered: readonly DraftSlot[],
    sent: DraftState,
    trackChanges?: boolean,
  ) {
    if (trackChanges !== undefined) committedToggle.current = trackChanges
    acknowledgedSlots.current = { covered, sent }
    persistBundle(bundleRef.current)
  }
  useDraftWriterClaim({
    storage,
    documentId: scope.documentId,
    writerId: () => storedScope().tabId,
    instanceId: instanceId.current,
  })
  function checkpoint(edit?: HistoryEdit) {
    history.record(bundleRef.current.state, edit)
  }

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
    committedToggle.current = undefined
    acknowledgedSlots.current = null
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

  const edits = createWorkspaceDraftEdits({
    getModel: () => scope.model,
    getState: () => bundleRef.current.state,
    setState,
    checkpoint,
  })

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
    history.clear()
    baseline.clear()
    setBlockedReason(null)
    setBundle({
      state: result.state,
      held: result.held,
      ...(result.trackChangesFlip !== undefined
        ? { trackChangesFlip: result.trackChangesFlip }
        : {}),
    })
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

  function setTrackChangesFlip(value: boolean | undefined) {
    setBundle((current) =>
      value === undefined
        ? { state: current.state, held: current.held }
        : { ...current, trackChangesFlip: value },
    )
  }

  return {
    trackChangesFlip: bundle.trackChangesFlip,
    setTrackChangesFlip,
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
    acknowledgeSave,
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
