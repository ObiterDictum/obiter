import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type {
  DocumentModelWire,
  DocumentPresence,
  DocumentVersionLineage,
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

/**
 * How many slots the containment pass removes, one at a time, looking for the
 * batch the server will accept. A rejected batch writes no version, so probing
 * costs requests but never history; the cap keeps that bounded.
 */
const MAX_ISOLATION_ATTEMPTS = 12

/** The tracked-change decision route's own change-id cap. */
const DOCUMENT_TRACKED_DECISION_MAX = 100

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

/**
 * The save state machine for the DOCX workspace.
 *
 * E45: a rejected operation used to stay in the draft state, so every later
 * save recomputed and resent it and legitimate work never reached the server.
 * Here a batch is planned from addressable slots only; a rejected batch is
 * contained by retrying without one slot at a time until the rest commits.
 * The refused slot then stays pending in the drafts — still painted, still
 * resent by the next save — with a banner naming it, so a refused batch can
 * never read as a successful save with an operation quietly dropped.
 */
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
  const editDocument = useEditDocument(documentId, matterId)
  const mergeDocument = useCollaborationMerge(documentId, matterId)
  const decideChange = useTrackedChangeDecision(documentId, matterId)
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  /**
   * Slots a refused batch identified as the cause; they stay pending. `sent`
   * is the state the refused request was planned from, so discarding can
   * clear only what the server saw and keep typing done after the refusal.
   */
  const [refused, setRefused] = useState<{
    slots: readonly DraftSlot[]
    sent: DraftState
  } | null>(null)
  const inFlight = useRef(false)

  const plan = model ? planDocumentSave(model, drafts.state) : EMPTY_PLAN
  const dirty = plan.operations.length > 0 || plan.rejections.length > 0
  // The boundary window is part of "a save is still landing": `save()` refuses
  // a second request while it lasts, so an enabled button would be inert.
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

  /** One request. Returns the version the server committed. */
  async function sendBatch(operations: SavePlan['operations']) {
    const collaborators = presence.some((item) => item.userId !== currentUserId)
    if (collaborators || remoteChange) {
      const saved = await mergeDocument.mutateAsync({
        baseVersionId,
        syncId: crypto.randomUUID(),
        operations,
        trackChanges,
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
        trackChanges,
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
        trackChanges,
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
    // Advances the history baseline as well as clearing the covered slots: a
    // snapshot taken while they were pending can never be replayed, and undo
    // still reverses a saved edit against the document the save produced. The
    // server's lineage is the authoritative identity for that translation.
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

  /**
   * Removes one slot at a time and retries the rest, so a change the server
   * will not accept cannot block the batch's other work. The isolated slot
   * stays in the drafts — pending, still painted, and resent by the next
   * save, where it often lands alone and succeeds — and the refused banner
   * names it with a discard affordance, so a refused batch can never report
   * success while an operation quietly disappears.
   */
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
        const result = await sendBatch(attempt.operations)
        // The candidate is left out of `without` only for this request; it
        // was never cleared from the draft state, so it stays pending while
        // the rest of the batch commits.
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

  /**
   * A flight must hand DOM focus back to the caret's field while a control
   * still holds it: `setFailure(null)` unmounts a focused Retry and `saving`
   * disables a focused Save, dropping focus to `document.body` and losing
   * the typed burst. Doing it at the only point a flight can begin covers
   * every entry point by construction.
   */
  function startFlight() {
    refocusCaretBeforeFlight()
    inFlight.current = true
    setFailure(null)
    setNotice(null)
  }

  async function save() {
    if (!model) return
    // A save whose lineage could not be reconciled leaves the history baseline
    // unresolved. Writing again could duplicate the covered work or retarget a
    // reversal, so the only safe action is to reload and discard.
    if (drafts.lineageUnresolved) return
    // A committed save whose result model has not reloaded yet is an unresolved
    // baseline: a second save would address the pre-save model and duplicate or
    // retarget the covered work.
    if (drafts.boundaryPending) return
    // Ctrl+S bypasses the disabled Save button, so two saves could otherwise
    // run against one base version and duplicate every insert in the batch.
    if (inFlight.current) return
    const sent = drafts.state
    const current = planDocumentSave(model, sent)
    // A tracked reversal is a decision version, not an edit. Send rejections
    // only when no edit operations are pending; otherwise save the edits first
    // and leave the rejection in state so neither is silently lost.
    if (current.operations.length === 0 && current.rejections.length > 0) {
      // Every pending group is one decision batch: the decision route is
      // all-or-nothing against one base version, so sending the groups
      // sequentially would commit the first and conflict the rest. One call
      // makes a multi-operation history step an atomic unit, or blocks whole.
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
        changeIds.length > DOCUMENT_TRACKED_DECISION_MAX ||
        removeParagraphIds.length > DOCUMENT_TRACKED_DECISION_MAX
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
        })
        // A decision version carries no lineage, and the rejected change id is
        // consumed, so the pre-edit snapshots cannot be replayed safely. The
        // rejection slots are cleared and Redo is deliberately unavailable
        // rather than targeting an obsolete id.
        drafts.clearSlots(
          current.rejections.map((rejection) => ({
            kind: 'tracked-reject' as const,
            key: rejection.key,
            ooxmlIds: rejection.ooxmlIds,
          })),
          sent,
        )
        drafts.resetHistoryAfterDecision()
        // Hold saves until the decision version's model reloads, so the next
        // edit is not planned against pre-decision run ids under the new base.
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
    if (current.operations.length === 0) return
    startFlight()
    try {
      const result = await sendBatch(current.operations)
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
        // Most recent slots first: the change that was just made is the most
        // likely to address something the server no longer has.
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
            : dirty ||
                plan.pending > 0 ||
                blocked.length > 0 ||
                held.length > 0 ||
                drafts.recoverable.length > 0 ||
                Boolean(drafts.staleDraft)
              ? { status: 'unsaved' }
              : { status: 'saved' }

  return {
    blocked,
    held,
    refused: refused?.slots ?? NO_REFUSED,
    dirty,
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
    discardBlocked: () => drafts.clearSlots(blocked.map((item) => item.slot)),
    discardHeld: (ids: readonly string[]) => drafts.discardHeld(ids),
    discardRefused: () => {
      // Only slots unchanged since the refused request was planned clear:
      // a slot the user edited after the refusal keeps the newer work, the
      // same way the held path kept the live state when the slot moved.
      if (refused) drafts.clearSlots(refused.slots, refused.sent)
      setRefused(null)
    },
    blockedHistoryMessage: blockedHistoryMessage(drafts.blockedReason),
  }
}
