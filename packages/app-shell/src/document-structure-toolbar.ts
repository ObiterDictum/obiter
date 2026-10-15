import type { DocumentModelWire } from '@obiter/contracts'
import { documentStory } from './document-model-text'
import {
  structuralDraftSchema,
  type ImageInsertFields,
  type StructuralDraft,
} from './document-structural-drafts'

export { storyTableCellIds } from './document-page-tables'

/**
 * Why an insert was refused after the picker already read the file. The draft
 * is validated against the persisted schema before it is accepted: an
 * unparseable structure slot would delete itself — and every sibling draft —
 * on the next restore, so an invalid draft is impossible to create.
 */
export type StructuralInsertOutcome =
  { inserted: true } | { inserted: false; reason: string }

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
    insertImage(fields: ImageInsertFields): StructuralInsertOutcome {
      if (pictureUnavailable || !paragraphId || offset == null) {
        return { inserted: false, reason: pictureUnavailable ?? 'No anchor' }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'image',
        paragraphId,
        offset,
        ...fields,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That image cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
  }
}
