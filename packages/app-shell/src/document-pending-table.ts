import type { DocumentModelWire } from '@obiter/contracts'
import type { TableStructureOperation } from '@obiter/ooxml'
import { storyTables } from './document-page-tables'
import { withStructuralDrafts } from './document-structure-fold'
import {
  structuralDraftSchema,
  type StructuralDraft,
} from './document-structural-drafts'

export function pendingTableDraft(
  model: DocumentModelWire,
  structures: StructuralDraft[],
  paragraphId: string,
) {
  for (const [index, draft] of structures.entries()) {
    if (draft.kind !== 'table') continue
    const before = withStructuralDrafts(
      model,
      structures.slice(0, index),
    ).stories.find((s) => s.kind === 'document')
    const after = withStructuralDrafts(
      model,
      structures.slice(0, index + 1),
    ).stories.find((s) => s.kind === 'document')
    if (!after) continue
    const oldIds = new Set(before?.paragraphs.map((p) => p.id))
    const table = storyTables(after).find(
      (t) =>
        t.paragraphIds.includes(paragraphId) &&
        t.paragraphIds.every((id) => !oldIds.has(id)),
    )
    if (!table) continue
    return draft
  }
  return undefined
}

export function pendingTableChange(
  model: DocumentModelWire,
  structures: StructuralDraft[],
  operation: TableStructureOperation,
): StructuralDraft[] | undefined {
  const draft = pendingTableDraft(model, structures, operation.paragraphId)
  if (!draft) return undefined
  const rows =
    draft.rows +
    (operation.type === 'insert_table_row'
      ? 1
      : operation.type === 'delete_table_row'
        ? -1
        : 0)
  const columns =
    draft.columns +
    (operation.type === 'insert_table_column'
      ? 1
      : operation.type === 'delete_table_column'
        ? -1
        : 0)
  if (operation.type === 'delete_table' || rows === 0 || columns === 0)
    return structures.filter((item) => item.id !== draft.id)
  const story = withStructuralDrafts(model, structures).stories.find(
    (item) => item.kind === 'document',
  )
  const table =
    story &&
    storyTables(story).find((item) =>
      item.paragraphIds.includes(operation.paragraphId),
    )
  if (!table) throw new Error('Missing pending table')
  const cells = table.rows.map((row) =>
    row.cells.map((cell) => {
      const paragraph = story.paragraphs.find(
        (item) => item.id === cell.paragraphIds[0],
      )
      if (!paragraph?.sourceParaId)
        throw new Error('Missing pending cell identity')
      return paragraph.sourceParaId
    }),
  )
  const rowIndex = table.rows.findIndex((row) =>
    row.cells.some((cell) => cell.paragraphIds.includes(operation.paragraphId)),
  )
  const columnIndex = table.rows[rowIndex]?.cells.findIndex((cell) =>
    cell.paragraphIds.includes(operation.paragraphId),
  )
  if (rowIndex < 0 || columnIndex === undefined || columnIndex < 0)
    throw new Error('Missing pending cell coordinates')
  const newId = () =>
    crypto.randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()
  if (operation.type === 'insert_table_row')
    cells.splice(
      rowIndex + (operation.position === 'after' ? 1 : 0),
      0,
      Array.from({ length: columns }, newId),
    )
  if (operation.type === 'delete_table_row') cells.splice(rowIndex, 1)
  if (operation.type === 'insert_table_column')
    for (const row of cells)
      row.splice(
        columnIndex + (operation.position === 'after' ? 1 : 0),
        0,
        newId(),
      )
  if (operation.type === 'delete_table_column')
    for (const row of cells) row.splice(columnIndex, 1)
  const updated = { ...draft, rows, columns, cellParaIds: cells.flat() }
  structuralDraftSchema.parse(updated)
  return structures.map((item) => (item.id === draft.id ? updated : item))
}
