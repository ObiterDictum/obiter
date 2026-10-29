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
} from './document-draft-state'

export type SavePlan = {
  operations: ReturnType<typeof collectEditOperations>
  covered: DraftSlot[]
  blocked: BlockedDraft[]
  pending: number
  rejections: ResolvedRejection[]
}

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
