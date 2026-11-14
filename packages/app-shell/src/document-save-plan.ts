import { pendingTableDraft } from './document-pending-table'
import { withStructuralDrafts } from './document-structure-fold'
import { storyTables } from './document-page-tables'
import type {
  DocumentModelWire,
  DocumentTextRunWire,
  TableCellEdit,
} from '@obiter/contracts'
import { collectEditOperations } from './document-edits'
import {
  compactRunProperties,
  runPropertiesFromFragments,
} from './document-edit-operations'
import { projectRangeEmphasis } from './document-format-paint'
import { paragraphFormatFields } from './document-paragraph-format'
import type {
  BlockedDraft,
  DraftSlot,
  DraftState,
} from './document-draft-state'
import type { FormatDrafts, PendingEmphasis } from './document-format-types'
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
  const baselineIds = new Set(
    model.stories.flatMap((story) => story.paragraphs.map((p) => p.id)),
  )
  const painted = withStructuralDrafts(model, keep.structures)
  const pendingCellIds = new Set<string>()
  for (const table of painted.stories.flatMap(storyTables)) {
    for (const row of table.rows) {
      for (const cell of row.cells) {
        for (const id of cell.paragraphIds) {
          if (!baselineIds.has(id)) pendingCellIds.add(id)
        }
      }
    }
  }
  const pendingCellRunIds = new Set(
    [...pendingCellIds].flatMap((id) =>
      (keep.extraRuns[id] ?? []).map((run) => run.id),
    ),
  )
  const pendingCellPayloads = new Map<string, TableCellEdit>()
  for (const table of painted.stories.flatMap(storyTables)) {
    table.rows.forEach((row, rowIndex) =>
      row.cells.forEach((cell, column) =>
        cell.paragraphIds.forEach((id) => {
          if (baselineIds.has(id)) return
          const edit = cellEditPayload(id, rowIndex, column, keep)
          if (edit) pendingCellPayloads.set(id, edit)
        }),
      ),
    )
  }
  for (const id of pendingCellIds) {
    delete keep.format.paragraphStyles[id]
    delete keep.format.numbering[id]
    delete keep.format.paragraphFormats[id]
  }
  keep.format.emphasis = keep.format.emphasis.filter(
    (item) =>
      !(item.runId !== undefined && pendingCellRunIds.has(item.runId)) &&
      !(item.paragraphId !== undefined && pendingCellIds.has(item.paragraphId)),
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
  for (const table of painted.stories.flatMap(storyTables)) {
    const cellEdits = table.rows.flatMap((row) =>
      row.cells.flatMap((cell) =>
        cell.paragraphIds.flatMap((id) => {
          if (baselineIds.has(id)) return []
          const edit = pendingCellPayloads.get(id)
          return edit ? [edit] : []
        }),
      ),
    )
    if (!cellEdits.length) continue
    const pending = pendingTableDraft(
      model,
      keep.structures,
      table.paragraphIds[0] ?? '',
    )
    if (pending) {
      const occurrence = keep.structures
        .filter(
          (draft) =>
            draft.kind === 'table' && draft.paragraphId === pending.paragraphId,
        )
        .indexOf(pending)
      const insert = operations.filter(
        (operation) =>
          operation.type === 'insert_table' &&
          operation.paragraphId === pending.paragraphId,
      )[occurrence]
      if (insert?.type !== 'insert_table')
        throw new Error('Missing insertion for pending table cell text')
      insert.cellEdits = cellEdits
      continue
    }
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

function cellEmphasisItems(
  paragraphId: string,
  runs: readonly DocumentTextRunWire[],
  emphasis: readonly PendingEmphasis[],
): PendingEmphasis[] {
  const items: PendingEmphasis[] = []
  let cursor = 0
  for (const run of runs) {
    const item = emphasis.find((entry) => entry.runId === run.id)
    if (item && run.text.length > 0) {
      items.push({
        ...item,
        paragraphId,
        from: cursor,
        to: cursor + run.text.length,
      })
    }
    cursor += run.text.length
  }
  for (const item of emphasis) {
    if (
      item.paragraphId === paragraphId &&
      item.from !== undefined &&
      item.to !== undefined
    ) {
      items.push(item)
    }
  }
  return items
}

function cellParagraphPayload(
  paragraphId: string,
  format: FormatDrafts,
): TableCellEdit['paragraph'] | undefined {
  const styleId = format.paragraphStyles[paragraphId]
  const numbering = format.numbering[paragraphId]
  const paragraphFormat = format.paragraphFormats[paragraphId]
  const paragraph = {
    ...(typeof styleId === 'string' ? { styleId } : {}),
    ...(numbering?.numId
      ? {
          numbering: {
            numId: numbering.numId,
            ilvl: numbering.ilvl ?? 0,
            ...(numbering.startOverride != null
              ? { startOverride: numbering.startOverride }
              : {}),
          },
        }
      : {}),
    ...(paragraphFormat ? paragraphFormatFields(paragraphFormat) : {}),
  }
  return Object.keys(paragraph).length > 0 ? paragraph : undefined
}

function cellEditPayload(
  paragraphId: string,
  row: number,
  column: number,
  keep: DraftState,
): TableCellEdit | undefined {
  const runs = (keep.extraRuns[paragraphId] ?? []).map((run) => ({
    ...run,
    text: keep.drafts[run.id] ?? run.text,
  }))
  const text = runs.map((run) => run.text).join('')
  const painted = projectRangeEmphasis(
    { id: paragraphId, runs, preservedXmlFragments: [] },
    cellEmphasisItems(paragraphId, runs, keep.format.emphasis),
  )
  const payloadRuns = painted.runs
    .map((run) => ({
      text: run.text,
      ...(run.styleId ? { styleId: run.styleId } : {}),
      ...compactRunProperties(
        runPropertiesFromFragments(run.preservedXmlFragments),
      ),
    }))
    .filter((run) => run.text.length > 0)
  const formatted = payloadRuns.some((run) => Object.keys(run).length > 1)
  const paragraph = cellParagraphPayload(paragraphId, keep.format)
  const edit: TableCellEdit = {
    row,
    column,
    ...(formatted && payloadRuns.length > 0
      ? { runs: payloadRuns }
      : text.length > 0
        ? { text }
        : {}),
    ...(paragraph ? { paragraph } : {}),
  }
  return edit.text === undefined &&
    edit.runs === undefined &&
    edit.paragraph === undefined
    ? undefined
    : edit
}

export {
  clearableSlots,
  emphasisSlotKey,
  hasDraftState,
  removeDraftSlots,
  slotLabel,
  splitDraftSlots,
} from './document-save-slots'
