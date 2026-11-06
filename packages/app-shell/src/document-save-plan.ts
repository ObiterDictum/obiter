import { withStructuralDrafts } from './document-structure-fold'
import { storyTables } from './document-page-tables'
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
  trackChanges?: boolean,
): SavePlan {
  const { keep, covered, blocked, pending, rejections } = partitionDraftState(
    model,
    state,
    trackChanges,
  )
  const operations = collectEditOperations(
    model,
    keep.drafts,
    keep.inserts,
    keep.deletedParagraphIds,
    keep.extraRuns,
    keep.format,
    keep.breaks,
    keep.structures,
  )
  const baselineIds = new Set(
    model.stories.flatMap((story) => story.paragraphs.map((p) => p.id)),
  )
  const painted = withStructuralDrafts(model, keep.structures)
  for (const table of painted.stories.flatMap(storyTables)) {
    const cellEdits = table.rows.flatMap((row, rowIndex) =>
      row.cells.flatMap((cell, column) =>
        cell.paragraphIds.flatMap((id) => {
          if (baselineIds.has(id)) return []
          const runs = keep.extraRuns[id]
          if (!runs?.length) return []
          return [
            {
              row: rowIndex,
              column,
              text: runs.map((run) => keep.drafts[run.id] ?? run.text).join(''),
            },
          ]
        }),
      ),
    )
    if (!cellEdits.length) continue
    for (let index = operations.length - 1; index >= 0; index--) {
      const operation = operations[index]
      if (
        operation &&
        (operation.type === 'insert_table_row' ||
          operation.type === 'insert_table_column' ||
          operation.type === 'delete_table_row' ||
          operation.type === 'delete_table_column') &&
        table.paragraphIds.includes(operation.paragraphId)
      ) {
        operations[index] = { ...operation, cellEdits }
        break
      }
    }
  }
  return {
    operations,
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
