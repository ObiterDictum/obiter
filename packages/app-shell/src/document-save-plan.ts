import type { DocumentModelWire } from '@obiter/contracts'
import { collectEditOperations } from './document-edits'
import type {
  BlockedDraft,
  DraftSlot,
  DraftState,
} from './document-draft-state'
import {
  partitionDraftState,
  type ResolvedRejection,
} from './document-save-partition'

export {
  emptyDraftState,
  isPendingBaselineId,
  PENDING_BASELINE_PREFIX,
} from './document-draft-state'
export type {
  BlockedDraft,
  DraftSlot,
  DraftState,
  StructureKind,
  TrackedRejection,
} from './document-draft-state'

export type SavePlan = {
  /** Addressable operations, safe to send as one batch. */
  operations: ReturnType<typeof collectEditOperations>
  /**
   * Slots the request covers. A successful save clears exactly these; every
   * other slot (blocked ones) survives.
   */
  covered: DraftSlot[]
  /** Slots that cannot be addressed against this model, so they are not sent. */
  blocked: BlockedDraft[]
  /**
   * Pending-baseline reversals that no model names yet. They are not sent and
   * not blocked, but they are unsaved work, so the workspace must not report
   * itself saved while one exists.
   */
  pending: number
  /**
   * Tracked-change decisions to send, one per history step. Each carries the
   * current version's wire change ids resolved from the persisted `w:id`s, and
   * any empty tracked-insert shells to remove in the same decision.
   */
  rejections: ResolvedRejection[]
}

/**
 * Partitions draft state into what the server can accept and what it cannot,
 * then compiles the covered slots into one edit batch.
 *
 * E45: a format draft keyed to a client-side pending-insert id was emitted as
 * `set_paragraph_style` against an id that does not exist server-side, so every
 * later save resent it and failed. Addressability is therefore decided in
 * `document-save-partition.ts`, against the loaded model, before any batch is
 * built. A slot whose target is absent from the model is held back rather than
 * sent, so one stale change cannot poison a later request, and the caller can
 * still clear precisely the slots the request covered.
 */
export function planDocumentSave(
  model: DocumentModelWire,
  state: DraftState,
): SavePlan {
  const { keep, covered, blocked, pending, rejections } = partitionDraftState(
    model,
    state,
  )
  return {
    operations: collectEditOperations(
      model,
      keep.drafts,
      keep.inserts,
      keep.deletedParagraphIds,
      keep.extraRuns,
      keep.format,
      keep.breaks,
      keep.structures,
    ),
    covered,
    blocked,
    pending,
    rejections,
  }
}

export {
  clearableSlots,
  emphasisSlotKey,
  hasDraftState,
  removeDraftSlots,
  slotLabel,
  splitDraftSlots,
} from './document-save-slots'
export type {
  SplitDraftSlotsResult,
  SplitKeysResult,
} from './document-save-slots'
