import { useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'
import {
  TRACKED_DECISION_MAX_IDS,
  type DocumentModelWire,
  type DocumentPresence,
  type DocumentVersionLineage,
} from '@obiter/contracts'
import { ApiError } from '../../api'
import {
  planDocumentSave,
  removeDraftSlots,
  type DraftSlot,
  type DraftState,
  type SavePlan,
} from '../../document-save-plan'
import {
  useCollaborationMerge,
  useEditDocument,
  useTrackedChangeDecision,
  workspaceKeys,
} from '../../document-workspace-api'
import { refocusCaretBeforeFlight } from './document-actions'
import { blockedHistoryMessage, messageFor } from './document-save-messages'
import type { WorkspaceDrafts } from './use-workspace-drafts'

const MAX_ISOLATION_ATTEMPTS = 12

export type SaveState =
  | { status: 'saved' }
  | { status: 'unsaved' }
  | { status: 'saving' }
  | { status: 'failed' }
  | { status: 'stale' }
  | { status: 'blocked' }

export type DocumentSave = ReturnType<typeof useDocumentSave>

const EMPTY_PLAN: SavePlan = {
  operations: [],
  covered: [],
  blocked: [],
  pending: 0,
  rejections: [],
}

const NO_REFUSED: readonly DraftSlot[] = []

export function useDocumentSave({
  documentId,
  matterId,
  model,
  drafts,
  baseVersionId,
  trackChanges,
  presence,
  currentUserId,
  remoteChange,
  onSaved,
}: {
  documentId: string
  matterId: string
  model: DocumentModelWire | undefined
  drafts: WorkspaceDrafts
  baseVersionId: string
  trackChanges: boolean
  presence: DocumentPresence[]
  currentUserId: string | undefined
  remoteChange: boolean
  onSaved: (versionId: string | null) => void
}) {
  const queryClient = useQueryClient()
  const pendingBatch = useRef<{
    covered: readonly DraftSlot[]
    sent: DraftState
  } | null>(null)
  function acknowledgeCommit(input: { trackChanges?: boolean }) {
    const batch = pendingBatch.current
    if (batch)
      drafts.acknowledgeSave(batch.covered, batch.sent, input.trackChanges)
  }
  const editDocument = useEditDocument(documentId, matterId, acknowledgeCommit)
  const mergeDocument = useCollaborationMerge(
    documentId,
    matterId,
    acknowledgeCommit,
  )
  const decideChange = useTrackedChangeDecision(documentId, matterId)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const [refused, setRefused] = useState<{
    slots: readonly DraftSlot[]
    sent: DraftState
  } | null>(null)
  const inFlight = useRef(false)

  const plan = useMemo(
    () => (model ? planDocumentSave(model, drafts.state) : EMPTY_PLAN),
    [model, drafts.state],
  )
  const togglePending = model ? trackChanges !== model.trackRevisions : false
  const dirty =
    plan.operations.length > 0 || plan.rejections.length > 0 || togglePending
  const editsPending =
    plan.operations.length > 0 ||
    plan.rejections.length > 0 ||
    plan.pending > 0 ||
    plan.blocked.length > 0 ||
    drafts.held.length > 0 ||
    drafts.recoverable.length > 0 ||
    Boolean(drafts.staleDraft)
  const saving =
    editDocument.isPending ||
    mergeDocument.isPending ||
    decideChange.isPending ||
    drafts.boundaryPending
  const blocked = plan.blocked
  const held = drafts.held

  async function reload() {
    drafts.resetDrafts()
    setStale(false)
    setFailure(null)
    setNotice(null)
    setRefused(null)
    onSaved(null)
    await queryClient.invalidateQueries({
      queryKey: workspaceKeys.model(documentId),
    })
    await queryClient.invalidateQueries({
      queryKey: workspaceKeys.sync(documentId),
    })
  }

  async function sendBatch(
    operations: SavePlan['operations'],
    covered: readonly DraftSlot[],
    sent: DraftState,
  ) {
    pendingBatch.current = { covered, sent }
    const flip = togglePending ? { trackChanges } : {}
    const collaborators = presence.some((item) => item.userId !== currentUserId)
    if (collaborators || remoteChange) {
      const saved = await mergeDocument.mutateAsync({
        baseVersionId,
        syncId: crypto.randomUUID(),
        operations,
        ...flip,
      })
      return {
        versionId: saved.versionId,
        versionNumber: saved.versionNumber,
        merged: remoteChange,
        lineage: saved.lineage,
      }
    }
    try {
      const saved = await editDocument.mutateAsync({
        baseVersionId,
        operations,
        ...flip,
      })
      return {
        versionId: saved.versionId,
        versionNumber: saved.versionNumber,
        merged: false,
        lineage: saved.lineage,
      }
    } catch (error) {
      if (!(error instanceof ApiError) || error.code !== 'conflict_detected') {
        throw error
      }
      const saved = await mergeDocument.mutateAsync({
        baseVersionId,
        syncId: crypto.randomUUID(),
        operations,
        ...flip,
      })
      return {
        versionId: saved.versionId,
        versionNumber: saved.versionNumber,
        merged: true,
        lineage: saved.lineage,
      }
    }
  }

  function commit(
    covered: readonly DraftSlot[],
    sent: DraftState,
    versionId: string,
    versionNumber: number | undefined,
    merged: boolean,
    lineage?: DocumentVersionLineage,
  ) {
    onSaved(versionId)
    if (model)
      drafts.commitSaveBoundary(
        covered,
        sent,
        model,
        baseVersionId,
        lineage,
        versionId,
        versionNumber,
      )
    setFailure(null)
    setStale(false)
    setRefused(null)
    if (merged) {
      setNotice(
        "Your changes were saved as a new version to avoid overwriting a colleague's work",
      )
    }
  }

  async function containRejection(
    source: DocumentModelWire,
    candidates: readonly DraftSlot[],
    sent: DraftState,
  ) {
    if (candidates.length === 1 && candidates[0]) {
      setRefused({ slots: [candidates[0]], sent })
      return true
    }
    for (const candidate of candidates.slice(0, MAX_ISOLATION_ATTEMPTS)) {
      const latest = drafts.latestState()
      const without = removeDraftSlots(latest, [candidate])
      const attempt = planDocumentSave(source, without)
      if (attempt.operations.length === 0) continue
      try {
        const result = await sendBatch(
          attempt.operations,
          attempt.covered,
          without,
        )
        commit(
          attempt.covered,
          without,
          result.versionId,
          result.versionNumber,
          result.merged,
          result.lineage,
        )
        setRefused({ slots: [candidate], sent: latest })
        return true
      } catch (error) {
        if (error instanceof ApiError && error.code === 'conflict_detected') {
          setStale(true)
          return true
        }
        if (
          !(error instanceof ApiError) ||
          error.code !== 'validation_failed'
        ) {
          setFailure(messageFor(error))
          return true
        }
      }
    }
    return false
  }

  function startFlight() {
    refocusCaretBeforeFlight()
    inFlight.current = true
    setFailure(null)
    setNotice(null)
  }

  async function save() {
    if (!model) return
    if (drafts.lineageUnresolved) return
    if (drafts.boundaryPending) return
    if (inFlight.current) return
    const sent = drafts.state
    const current = planDocumentSave(model, sent)
    if (current.operations.length === 0 && current.rejections.length > 0) {
      const changeIds = [
        ...new Set(
          current.rejections.flatMap((rejection) => rejection.changeIds),
        ),
      ]
      const removeParagraphIds = [
        ...new Set(
          current.rejections.flatMap(
            (rejection) => rejection.removeParagraphIds ?? [],
          ),
        ),
      ]
      if (
        changeIds.length > TRACKED_DECISION_MAX_IDS ||
        removeParagraphIds.length > TRACKED_DECISION_MAX_IDS
      ) {
        setFailure(
          'This undo reverses more tracked changes than one decision can carry. Reload and review them in Review \u25b8 Changes.',
        )
        return
      }
      startFlight()
      try {
        const saved = await decideChange.mutateAsync({
          baseVersionId,
          action: 'reject',
          changeIds,
          ...(removeParagraphIds.length > 0 ? { removeParagraphIds } : {}),
          ...(togglePending ? { trackRevisions: trackChanges } : {}),
        })
        drafts.clearSlots(
          current.rejections.map((rejection) => ({
            kind: 'tracked-reject' as const,
            key: rejection.key,
            ooxmlIds: rejection.ooxmlIds,
          })),
          sent,
        )
        drafts.resetHistoryAfterDecision()
        drafts.markDecisionCommitted(saved.versionId, saved.versionNumber)
        onSaved(saved.versionId)
        setFailure(null)
        setStale(false)
      } catch (error) {
        if (error instanceof ApiError && error.code === 'conflict_detected') {
          setStale(true)
          return
        }
        setFailure(messageFor(error))
      } finally {
        inFlight.current = false
      }
      return
    }
    if (current.operations.length === 0 && !togglePending) return
    startFlight()
    try {
      const result = await sendBatch(current.operations, current.covered, sent)
      commit(
        current.covered,
        sent,
        result.versionId,
        result.versionNumber,
        result.merged,
        result.lineage,
      )
    } catch (error) {
      if (error instanceof ApiError && error.code === 'conflict_detected') {
        setStale(true)
        return
      }
      if (error instanceof ApiError && error.code === 'validation_failed') {
        const isolated = await containRejection(
          model,
          [...current.covered].reverse(),
          sent,
        )
        if (!isolated) {
          setFailure(
            'Your changes have not been saved. The server rejected the request and the change that caused it could not be identified. Nothing is lost: your work is still in this tab. Reloading discards it.',
          )
        }
        return
      }
      setFailure(messageFor(error))
    } finally {
      inFlight.current = false
    }
  }

  const saveState: SaveState = drafts.lineageUnresolved
    ? { status: 'blocked' }
    : drafts.boundaryPending
      ? { status: 'saving' }
      : stale
        ? { status: 'stale' }
        : saving
          ? { status: 'saving' }
          : failure
            ? { status: 'failed' }
            : dirty || editsPending
              ? { status: 'unsaved' }
              : { status: 'saved' }

  return {
    operations: plan.operations,
    blocked,
    held,
    refused: refused?.slots ?? NO_REFUSED,
    dirty,
    editsPending,
    saving,
    persistence: drafts.persistence,
    stale,
    lineageUnresolved: drafts.lineageUnresolved,
    saveState,
    failure,
    notice,
    save: () => void save(),
    retry: () => void save(),
    reload: () => void reload(),
    markStale: () => setStale(true),
    discardBlocked: () => drafts.clearSlots(blocked.map((item) => item.slot)),
    discardHeld: (ids: readonly string[]) => drafts.discardHeld(ids),
    discardRefused: () => {
      if (refused) drafts.clearSlots(refused.slots, refused.sent)
      setRefused(null)
    },
    blockedHistoryMessage: blockedHistoryMessage(drafts.blockedReason),
  }
}
