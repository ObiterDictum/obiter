import { useQueryClient } from '@tanstack/react-query'
import { useRef, useState } from 'react'
import type { DocumentModelWire, DocumentPresence } from '@obiter/contracts'
import { ApiError } from '../../api'
import {
  planDocumentSave,
  removeDraftSlots,
  slotLabel,
  type BlockedDraft,
  type DraftSlot,
  type DraftState,
  type SavePlan,
} from '../../document-save-plan'
import {
  useCollaborationMerge,
  useEditDocument,
  workspaceKeys,
} from '../../document-workspace-api'
import type { WorkspaceDrafts } from './use-workspace-drafts'

/**
 * How many slots the containment pass removes, one at a time, looking for the
 * batch the server will accept. A rejected batch writes no version, so probing
 * costs requests but never history; the cap keeps that bounded.
 */
const MAX_ISOLATION_ATTEMPTS = 12

export type SaveState =
  | { status: 'saved' }
  | { status: 'unsaved' }
  | { status: 'saving' }
  | { status: 'failed' }
  | { status: 'stale' }

export type DocumentSave = ReturnType<typeof useDocumentSave>

const EMPTY_PLAN: SavePlan = { operations: [], covered: [], blocked: [] }

/**
 * The save state machine for the DOCX workspace.
 *
 * E45: a rejected operation used to stay in the draft state, so every later
 * save recomputed and resent it and legitimate work never reached the server.
 * Here a batch is planned from addressable slots only, a rejected batch is
 * contained by holding one slot back and retrying the rest, and the failure is
 * reported as unsaved rather than as a generic invalid request.
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
  const [failure, setFailure] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [stale, setStale] = useState(false)
  const inFlight = useRef(false)

  const plan = model ? planDocumentSave(model, drafts.state) : EMPTY_PLAN
  const dirty = plan.operations.length > 0
  const saving = editDocument.isPending || mergeDocument.isPending
  const blocked = plan.blocked
  const held = drafts.held

  async function reload() {
    drafts.resetDrafts()
    setStale(false)
    setFailure(null)
    setNotice(null)
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
      return { versionId: saved.versionId, merged: remoteChange }
    }
    try {
      const saved = await editDocument.mutateAsync({
        baseVersionId,
        operations,
        trackChanges,
      })
      return { versionId: saved.versionId, merged: false }
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
      return { versionId: saved.versionId, merged: true }
    }
  }

  function commit(
    covered: readonly DraftSlot[],
    sent: DraftState,
    versionId: string,
    merged: boolean,
  ) {
    onSaved(versionId)
    // Only the slots this request covered, and only if they still hold what it
    // sent: anything blocked, held, or edited while the request was in flight
    // stays unsaved and must keep saying so.
    drafts.clearSlots(covered, sent)
    setFailure(null)
    setStale(false)
    if (merged) {
      setNotice(
        "Your changes were saved as a new version to avoid overwriting a colleague's work",
      )
    }
  }

  /**
   * Removes one slot at a time and retries the rest, so a change the server
   * will not accept is held back instead of blocking every later save. The
   * first batch that commits wins; the removed slot moves to the held list
   * untouched, so nothing typed is deleted.
   */
  async function containRejection(
    source: DocumentModelWire,
    candidates: readonly DraftSlot[],
  ) {
    for (const candidate of candidates.slice(0, MAX_ISOLATION_ATTEMPTS)) {
      const without = removeDraftSlots(drafts.state, [candidate])
      const attempt = planDocumentSave(source, without)
      if (attempt.operations.length === 0) continue
      try {
        const result = await sendBatch(attempt.operations)
        // Hold first, then clear. Both updates land in one commit, and clearing
        // composes on top of the held state rather than replacing it.
        drafts.holdSlot(
          candidate,
          slotLabel(candidate),
          'The server rejected this change.',
        )
        commit(attempt.covered, without, result.versionId, result.merged)
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

  async function save() {
    if (!model) return
    // Ctrl+S bypasses the disabled Save button, so two saves could otherwise
    // run against one base version and duplicate every insert in the batch.
    if (inFlight.current) return
    const sent = drafts.state
    const current = planDocumentSave(model, sent)
    if (current.operations.length === 0) return
    inFlight.current = true
    setFailure(null)
    setNotice(null)
    try {
      const result = await sendBatch(current.operations)
      commit(current.covered, sent, result.versionId, result.merged)
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

  const saveState: SaveState = stale
    ? { status: 'stale' }
    : saving
      ? { status: 'saving' }
      : failure
        ? { status: 'failed' }
        : dirty || blocked.length > 0 || held.length > 0
          ? { status: 'unsaved' }
          : { status: 'saved' }

  return {
    blocked,
    held,
    dirty,
    saving,
    persistence: drafts.persistence,
    stale,
    saveState,
    failure,
    notice,
    save: () => void save(),
    retry: () => void save(),
    reload: () => void reload(),
    discardBlocked: () => drafts.clearSlots(blocked.map((item) => item.slot)),
    discardHeld: (ids: readonly string[]) => drafts.discardHeld(ids),
  }
}

function messageFor(error: unknown) {
  if (error instanceof ApiError) {
    return `Your changes have not been saved. ${error.message}`
  }
  return 'Your changes have not been saved. The request failed before the server committed anything.'
}

/** One sentence naming what could not be sent and what to do about it. */
export function blockedSummary(blocked: readonly BlockedDraft[]) {
  if (blocked.length === 0) return null
  if (blocked.length === 1) {
    const label = blocked[0]?.label ?? 'a change'
    return `${capitalise(label)} could not be sent because it no longer matches the document. Discard it to keep saving.`
  }
  return `${String(blocked.length)} changes could not be sent because they no longer match the document. Discard them to keep saving.`
}

function capitalise(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1)
}
