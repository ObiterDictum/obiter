import type { DocumentModelWire } from '@obiter/contracts'
import type { TableStructureOperation } from '@obiter/ooxml'
import { storyTables } from './document-page-tables'
import { withStructuralDrafts } from './document-structure-fold'
import {
  structuralDraftSchema,
  type StructuralDraft,
} from './document-structural-drafts'

export function pendingTableChange(
  model: DocumentModelWire,
  structures: StructuralDraft[],
  operation: TableStructureOperation,
): StructuralDraft[] | undefined {
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
        t.paragraphIds.includes(operation.paragraphId) &&
        t.paragraphIds.every((id) => !oldIds.has(id)),
    )
    if (!table) continue
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
    const updated = { ...draft, rows, columns }
    structuralDraftSchema.parse(updated)
    return structures.map((item) => (item.id === draft.id ? updated : item))
  }
  return undefined
}
