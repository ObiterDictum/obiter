import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import type { DraftState } from './document-draft-state'
import { documentStory } from './document-model-text'
import { pendingTableDraft } from './document-pending-table'
import { storyTables, type DisplayTable } from './document-page-tables'
import { withStructuralDrafts } from './document-structure-fold'
import type { StructuralDraft } from './document-structural-drafts'

export type PendingCellInsert = {
  anchorParagraphId: string
  occurrence: number
  rowIndex: number
  columnIndex: number
  paragraphIndex: number
}

type PendingCellGroup = {
  storyIndex: number
  cells: Array<{
    row: number
    column: number
    slots: Array<{ id: string; index: number }>
  }>
  shared: string[]
  anchorId?: string
  occurrence: number
}

function pendingCellGroups(
  model: DocumentModelWire,
  structures: readonly StructuralDraft[],
): PendingCellGroup[] {
  const baselineIds = new Set(
    model.stories.flatMap((story) => story.paragraphs.map((p) => p.id)),
  )
  const painted = withStructuralDrafts(model, [...structures])
  const groups: PendingCellGroup[] = []
  painted.stories.forEach((paintedStory, storyIndex) => {
    if (!model.stories[storyIndex]) return
    for (const table of storyTables(paintedStory)) {
      const cells = table.rows
        .flatMap((row, rowIndex) =>
          row.cells.map((cell, columnIndex) => ({
            row: rowIndex,
            column: columnIndex,
            slots: cell.paragraphIds.flatMap((id, index) =>
              baselineIds.has(id) ? [] : [{ id, index }],
            ),
          })),
        )
        .filter((cell) => cell.slots.length > 0)
      if (cells.length === 0) continue
      const first = table.paragraphIds[0]
      const draft =
        first === undefined
          ? undefined
          : pendingTableDraft(model, [...structures], first)
      groups.push({
        storyIndex,
        cells,
        shared: table.paragraphIds.filter((id) => baselineIds.has(id)),
        anchorId: draft?.paragraphId,
        occurrence: draft
          ? structures
              .filter(
                (item) =>
                  item.kind === 'table' &&
                  item.paragraphId === draft.paragraphId,
              )
              .indexOf(draft)
          : -1,
      })
    }
  })
  return groups
}

export function pendingCellSlotIds(model: DocumentModelWire, sent: DraftState) {
  const paragraphIds = new Set<string>()
  for (const group of pendingCellGroups(model, sent.structures)) {
    for (const cell of group.cells) {
      for (const slot of cell.slots) paragraphIds.add(slot.id)
    }
  }
  const runIds = new Set<string>()
  for (const id of paragraphIds) {
    for (const run of sent.extraRuns[id] ?? []) runIds.add(run.id)
  }
  return { paragraphIds, runIds }
}

function tableOrder(story: DocumentStoryWire, table: DisplayTable) {
  const order = new Map(
    story.paragraphs.map((paragraph, index) => [paragraph.id, index] as const),
  )
  return Math.min(
    ...table.paragraphIds.map(
      (id) => order.get(id) ?? Number.POSITIVE_INFINITY,
    ),
  )
}

function savedTableFor(
  group: PendingCellGroup,
  story: DocumentStoryWire,
): DisplayTable | undefined {
  const tables = storyTables(story)
  if (group.shared.length > 0) {
    const shared = new Set(group.shared)
    return tables.find((table) =>
      table.paragraphIds.some((id) => shared.has(id)),
    )
  }
  if (group.anchorId === undefined || group.occurrence < 0) return undefined
  const order = new Map(
    story.paragraphs.map((paragraph, index) => [paragraph.id, index] as const),
  )
  const anchorIndex = order.get(group.anchorId)
  if (anchorIndex === undefined) return undefined
  return tables
    .map((table) => ({ table, at: tableOrder(story, table) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at > anchorIndex)
    .sort((a, b) => a.at - b.at)[group.occurrence]?.table
}

export function pendingCellIdMap(
  model: DocumentModelWire,
  sent: DraftState,
  toModel: DocumentModelWire | undefined,
): Map<string, string> {
  const map = new Map<string, string>()
  if (!toModel) return map
  for (const group of pendingCellGroups(model, sent.structures)) {
    const story = toModel.stories[group.storyIndex]
    if (!story) continue
    const table = savedTableFor(group, story)
    if (!table) continue
    for (const cell of group.cells) {
      const target = table.rows[cell.row]?.cells[cell.column]
      if (!target) continue
      for (const slot of cell.slots) {
        const toId = target.paragraphIds[slot.index]
        if (toId !== undefined) map.set(slot.id, toId)
      }
    }
  }
  return map
}

export function pendingCellInsert(
  model: DocumentModelWire | undefined,
  painted: DocumentModelWire | undefined,
  structures: readonly StructuralDraft[],
  paragraphId: string | null,
): PendingCellInsert | undefined {
  if (!model || !painted || !paragraphId) return undefined
  const draft = pendingTableDraft(model, [...structures], paragraphId)
  if (!draft) return undefined
  const story = documentStory(painted)
  const table = story
    ? storyTables(story).find((item) => item.paragraphIds.includes(paragraphId))
    : undefined
  if (!table) return undefined
  const rowIndex = table.rows.findIndex((row) =>
    row.cells.some((cell) => cell.paragraphIds.includes(paragraphId)),
  )
  const row = table.rows[rowIndex]
  const columnIndex = row?.cells.findIndex((item) =>
    item.paragraphIds.includes(paragraphId),
  )
  const paragraphIndex =
    columnIndex === undefined || columnIndex < 0
      ? -1
      : (row?.cells[columnIndex]?.paragraphIds.indexOf(paragraphId) ?? -1)
  if (rowIndex < 0 || !row || columnIndex === undefined || paragraphIndex < 0) {
    return undefined
  }
  return {
    anchorParagraphId: draft.paragraphId,
    occurrence: structures
      .filter(
        (item) =>
          item.kind === 'table' && item.paragraphId === draft.paragraphId,
      )
      .indexOf(draft),
    rowIndex,
    columnIndex,
    paragraphIndex,
  }
}

export function savedCellAnchor(
  model: DocumentModelWire,
  pending: PendingCellInsert,
): { paragraphId: string } | undefined {
  const story = documentStory(model)
  if (!story) return undefined
  const order = new Map(
    story.paragraphs.map((paragraph, index) => [paragraph.id, index] as const),
  )
  const anchorIndex = order.get(pending.anchorParagraphId)
  if (anchorIndex === undefined) return undefined
  const cell = storyTables(story)
    .map((table) => ({ table, at: tableOrder(story, table) }))
    .filter((entry) => Number.isFinite(entry.at) && entry.at > anchorIndex)
    .sort((a, b) => a.at - b.at)[pending.occurrence]?.table.rows[
    pending.rowIndex
  ]?.cells[pending.columnIndex]
  const paragraphId = cell?.paragraphIds[pending.paragraphIndex]
  return paragraphId === undefined ? undefined : { paragraphId }
}
