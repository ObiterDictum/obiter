import type { DocumentModelWire } from '@obiter/contracts'
import type { ParagraphRange } from './document-format-toolbar'
import { documentStory } from './document-model-text'
import {
  conflictingStructure,
  structuralKindNoun,
  type StructuralPlacement,
} from './document-structure-conflicts'
import type { ExtraRuns } from './document-word-edits'
import {
  crossReferenceTargetLabel,
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
  selectionRange,
  deletedParagraphIds,
  trackChanges,
  structures,
  drafts,
  extraRuns,
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
  /** The selection's range when it sits inside exactly one paragraph. */
  selectionRange: ParagraphRange | null
  /** Paragraphs marked for deletion, so a chooser never offers one. */
  deletedParagraphIds: ReadonlySet<string>
  trackChanges: boolean
  /** The drafts already held, so a second structural change in the same
   * paragraph is refused up front rather than blocked at save. */
  structures: StructuralDraft[]
  drafts: Record<string, string>
  extraRuns: ExtraRuns
  setStructures: SetStructures
}) {
  const story = model ? documentStory(model) : undefined
  // The same run-level rule the save plan enforces: the reason names the
  // earlier draft a candidate cannot compose with.
  const conflictWith = (candidate: StructuralPlacement) => {
    const wire = story?.paragraphs.find(
      (paragraph) => paragraph.id === candidate.paragraphId,
    )
    const earlier = wire
      ? conflictingStructure(
          wire,
          drafts,
          extraRuns[candidate.paragraphId] ?? [],
          structures,
          candidate,
        )
      : undefined
    return earlier
      ? `The paragraph already holds a ${structuralKindNoun(earlier.kind)} this cannot be combined with.`
      : undefined
  }
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
    (offset == null || !paragraphId
      ? 'Place the cursor in the paragraph text to insert a picture'
      : conflictWith({ kind: 'image', paragraphId, offset }))
  // A link is the inverse of an insertion: it needs a live selection over a
  // single stored paragraph rather than a collapsed caret.
  const linkUnavailable = trackChanges
    ? 'A link is not recorded as a tracked change'
    : !selectionRange
      ? selectionActive
        ? 'Select text within one paragraph to link'
        : 'Select the text to link'
      : !story?.paragraphs.some(
            (paragraph) => paragraph.id === selectionRange.paragraphId,
          )
        ? 'Save the new paragraph before linking its text'
        : conflictWith({
            kind: 'link',
            paragraphId: selectionRange.paragraphId,
            from: selectionRange.from,
            to: selectionRange.to,
          })
  const crossReferenceUnavailable =
    baseUnavailable ??
    (offset == null || !paragraphId
      ? 'Place the cursor in the paragraph text to insert a cross-reference'
      : conflictWith({ kind: 'cross-reference', paragraphId, offset }))
  // A bookmark can wrap any stored paragraph, including a table cell's, so the
  // chooser lists the whole story minus paragraphs marked for deletion.
  const crossReferenceTargets = (story?.paragraphs ?? [])
    .filter((paragraph) => !deletedParagraphIds.has(paragraph.id))
    .map((paragraph) => ({
      id: paragraph.id,
      label: crossReferenceTargetLabel(model, paragraph.id),
    }))

  return {
    tableUnavailable,
    pictureUnavailable,
    linkUnavailable,
    crossReferenceUnavailable,
    crossReferenceTargets,
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
    insertLink(target: string): StructuralInsertOutcome {
      if (linkUnavailable || !selectionRange) {
        return {
          inserted: false,
          reason: linkUnavailable ?? 'No text selected',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'link',
        paragraphId: selectionRange.paragraphId,
        from: selectionRange.from,
        to: selectionRange.to,
        target,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'Enter an http, https or mailto address.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
    insertCrossReference(targetParagraphId: string): StructuralInsertOutcome {
      if (crossReferenceUnavailable || !paragraphId || offset == null) {
        return {
          inserted: false,
          reason: crossReferenceUnavailable ?? 'No anchor',
        }
      }
      if (
        !crossReferenceTargets.some((target) => target.id === targetParagraphId)
      ) {
        return {
          inserted: false,
          reason: 'That reference target is no longer available.',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'cross-reference',
        paragraphId,
        offset,
        targetParagraphId,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That reference cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
  }
}
