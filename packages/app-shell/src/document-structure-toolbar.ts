import type { DocumentModelWire, DocumentStoryWire } from '@obiter/contracts'
import { documentStory } from './document-model-text'
import { storyBlocks } from './document-page-tables'
import type {
  ImageInsertFields,
  StructuralDraft,
} from './document-structural-drafts'

type SetStructures = (
  update: (current: StructuralDraft[]) => StructuralDraft[],
) => void

/**
 * The Insert ribbon's table and picture controls. Both anchor to a stored
 * body paragraph: a selection has no single insertion point, a pending
 * paragraph insert has no server id yet, tracked changes cannot record a
 * package-level insertion, and a table cell is not a body paragraph, so each
 * case gets an honest disabled reason rather than a silent no-op.
 *
 * A picture additionally needs the caret offset: it splices an inline drawing
 * run at that point in the paragraph's effective text. A table is a block and
 * needs only the anchor paragraph.
 */
export function documentStructureToolbar({
  paragraphId,
  model,
  cellParagraphIds,
  offset,
  selectionActive,
  trackChanges,
  setStructures,
}: {
  paragraphId: string | null
  /** The stored model — a pending paragraph or cell wire is not an anchor. */
  model: DocumentModelWire | undefined
  /**
   * The paragraph ids the story's tables bind — `storyTableCellIds`, memoised
   * by the caller on the model so the block partition is not re-parsed per
   * render.
   */
  cellParagraphIds: ReadonlySet<string>
  /** The caret's effective-text offset, or null when unresolved. */
  offset: number | null
  selectionActive: boolean
  trackChanges: boolean
  setStructures: SetStructures
}) {
  const story = model ? documentStory(model) : undefined
  const anchor = story?.paragraphs.some(
    (paragraph) => paragraph.id === paragraphId,
  )
  const inTableCell = Boolean(paragraphId && cellParagraphIds.has(paragraphId))
  const baseUnavailable = trackChanges
    ? 'Insertions are not recorded as a tracked change'
    : selectionActive
      ? 'Collapse the selection to insert'
      : !paragraphId
        ? 'Place the cursor in a paragraph to insert'
        : !anchor
          ? 'Save the new paragraph before inserting into it'
          : undefined
  const tableUnavailable =
    baseUnavailable ??
    (inTableCell ? 'A table cell cannot hold a table' : undefined)
  const pictureUnavailable =
    baseUnavailable ??
    (offset == null
      ? 'Place the cursor in the paragraph text to insert a picture'
      : undefined)

  return {
    tableUnavailable,
    pictureUnavailable,
    insertTable(rows: number, columns: number) {
      if (tableUnavailable || !paragraphId) return
      setStructures((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'table',
          paragraphId,
          rows,
          columns,
        },
      ])
    },
    insertImage(fields: ImageInsertFields) {
      if (pictureUnavailable || !paragraphId || offset == null) return
      setStructures((current) => [
        ...current,
        {
          id: crypto.randomUUID(),
          kind: 'image',
          paragraphId,
          offset,
          ...fields,
        },
      ])
    },
  }
}

/**
 * The paragraph ids bound inside the story's tables. Cell paragraphs are
 * story paragraphs, but the writer refuses them as anchors — a nested `w:tbl`
 * is not a body-level block — so the ribbon must refuse them too. Reads the
 * same `storyBlocks` binding the paint uses, so paraId-less stored tables
 * resolve by position exactly as they render.
 */
export function storyTableCellIds(
  story: DocumentStoryWire | undefined,
): Set<string> {
  const ids = new Set<string>()
  if (!story) return ids
  for (const block of storyBlocks(story)) {
    if (block.type !== 'table') continue
    for (const id of block.table.paragraphIds) ids.add(id)
  }
  return ids
}
