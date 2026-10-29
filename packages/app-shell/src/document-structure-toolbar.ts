import { PAGE_STORY_KINDS, type DocumentModelWire } from '@obiter/contracts'
import {
  isTableOfContentsHeading,
  tableOfContentsAnchorBlock,
  tableOfContentsHeadingsBlock,
} from './document-toc-availability'
import type { BreakDraft } from './document-draft-state'
import type { FormatDrafts } from './document-format-types'
import type { ParagraphRange } from './document-format-toolbar'
import { documentLegalToolbar } from './document-legal-toolbar'
import type { TableOfAuthoritiesFacts } from './document-legal-toolbar'
import { documentStory, editableParagraph } from './document-model-text'
import type { LocalInsert } from './document-story-flow'
import {
  conflictingStructure,
  structuralKindNoun,
  type StructuralPlacement,
} from './document-structure-conflicts'
import type { ExtraRuns } from './document-word-edits'
import type { ImageInsertFields } from './document-image-inserts'
import { crossReferenceTargetLabel } from './document-structure-overlays'
import {
  footnoteNoteParagraphId,
  structuralDraftSchema,
  type StructuralDraft,
} from './document-structural-drafts'

export { storyTableCellIds } from './document-page-tables'

export type StructuralInsertOutcome =
  { inserted: true } | { inserted: false; reason: string }

export type FootnoteInsertOutcome =
  | { inserted: true; noteParagraphId: string }
  | { inserted: false; reason: string }

type SetStructures = (
  update: (current: StructuralDraft[]) => StructuralDraft[],
) => void

export function documentStructureToolbar({
  paragraphId,
  model,
  painted,
  cellParagraphIds,
  offset,
  selectionActive,
  selectionRange,
  deletedParagraphIds,
  trackChanges,
  structures,
  drafts,
  extraRuns,
  format,
  breaks,
  inserts,
  setStructures,
  toaFacts,
}: {
  paragraphId: string | null
  model: DocumentModelWire | undefined
  painted?: DocumentModelWire | undefined
  cellParagraphIds: ReadonlySet<string>
  offset: number | null
  selectionActive: boolean
  selectionRange: ParagraphRange | null
  deletedParagraphIds: ReadonlySet<string>
  trackChanges: boolean
  structures: StructuralDraft[]
  drafts: Record<string, string>
  extraRuns: ExtraRuns
  format: FormatDrafts
  breaks: readonly BreakDraft[]
  inserts: readonly LocalInsert[]
  setStructures: SetStructures
  toaFacts: TableOfAuthoritiesFacts
}) {
  const story = model ? documentStory(model) : undefined
  const refreshCovered = new Set(
    structures
      .filter((item) => item.kind === 'table-of-authorities-refresh')
      .flatMap(
        (item) => toaFacts.fields.get(item.paragraphId)?.resultIds ?? [],
      ),
  )
  const conflictWith = (candidate: StructuralPlacement) => {
    if (refreshCovered.has(candidate.paragraphId)) {
      return 'The paragraph is inside a table of authorities that is already queued to update.'
    }
    const wire = model
      ? editableParagraph(model, candidate.paragraphId)
      : undefined
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
          ? model && editableParagraph(model, paragraphId)
            ? 'Only the document body can hold this insertion'
            : 'Save the new paragraph before inserting into it'
          : undefined
  const tableUnavailable =
    baseUnavailable ??
    (inTableCell ? 'A table cell cannot hold a table' : undefined)
  const pictureUnavailable =
    baseUnavailable ??
    (offset == null || !paragraphId
      ? 'Place the cursor in the paragraph text to insert a picture'
      : conflictWith({ kind: 'image', paragraphId, offset }))
  const linkUnavailable = trackChanges
    ? 'A link is not recorded as a tracked change'
    : !selectionRange
      ? selectionActive
        ? 'Select text within one paragraph to link'
        : 'Select the text to link'
      : !story?.paragraphs.some(
            (paragraph) => paragraph.id === selectionRange.paragraphId,
          )
        ? model && editableParagraph(model, selectionRange.paragraphId)
          ? 'Only the document body can hold a link'
          : 'Save the new paragraph before linking its text'
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
  const footnoteUnavailable =
    baseUnavailable ??
    (inTableCell
      ? 'A table cell cannot hold a footnote'
      : offset == null || !paragraphId
        ? 'Place the cursor in the paragraph text to insert a footnote'
        : conflictWith({ kind: 'footnote', paragraphId, offset }))
  const anchorStory =
    paragraphId && model
      ? model.stories.find((story) =>
          story.paragraphs.some((paragraph) => paragraph.id === paragraphId),
        )
      : undefined
  const pageNumberUnavailable = trackChanges
    ? 'Insertions are not recorded as a tracked change'
    : selectionActive
      ? 'Collapse the selection to insert a page number'
      : !paragraphId
        ? 'Place the cursor in a paragraph to insert a page number'
        : anchorStory && !PAGE_STORY_KINDS.has(anchorStory.kind)
          ? 'A page number needs a page of its own: the body, a header or a footer.'
          : !anchorStory
            ? 'Save the new paragraph before inserting into it'
            : offset == null
              ? 'Place the cursor in the paragraph text to insert a page number'
              : conflictWith({ kind: 'page-number', paragraphId, offset })
  const paintedStory = painted ? documentStory(painted) : undefined
  const storedParagraphIds = new Set(
    (story?.paragraphs ?? []).map((paragraph) => paragraph.id),
  )
  const tableOfContentsHeadings = (paintedStory?.paragraphs ?? []).filter(
    (paragraph) =>
      storedParagraphIds.has(paragraph.id) &&
      !deletedParagraphIds.has(paragraph.id) &&
      isTableOfContentsHeading(paragraph, model?.styles ?? []),
  )
  const anchorWire =
    paragraphId && story
      ? story.paragraphs.find((paragraph) => paragraph.id === paragraphId)
      : undefined
  const tableOfContentsAnchor =
    anchorWire === undefined
      ? undefined
      : tableOfContentsAnchorBlock(
          anchorWire,
          cellParagraphIds,
          model?.changes ?? [],
        )
  const tableOfContentsUnavailable =
    baseUnavailable ??
    (inTableCell
      ? 'A table cell cannot hold a table of contents'
      : offset == null || !paragraphId
        ? 'Place the cursor in the paragraph text to insert a table of contents'
        : (tableOfContentsAnchor ??
          tableOfContentsHeadingsBlock(
            tableOfContentsHeadings,
            model?.changes ?? [],
          ) ??
          conflictWith({
            kind: 'table-of-contents',
            paragraphId,
            offset,
          })))
  const legal = documentLegalToolbar({
    model,
    paragraphId,
    offset,
    selectionActive,
    selectionRange,
    trackChanges,
    structures,
    baseUnavailable,
    inTableCell,
    anchorWire,
    cellParagraphIds,
    conflictWith,
    toaFacts,
    drafts,
    extraRuns,
    deletedParagraphIds,
    format,
    breaks,
    inserts,
    setStructures,
  })
  const crossReferenceTargets = (story?.paragraphs ?? [])
    .filter(
      (paragraph) =>
        paragraph.id !== paragraphId && !deletedParagraphIds.has(paragraph.id),
    )
    .map((paragraph) => ({
      id: paragraph.id,
      label: crossReferenceTargetLabel(model, paragraph.id),
    }))

  return {
    tableUnavailable,
    pictureUnavailable,
    linkUnavailable,
    definedTermUnavailable: legal.definedTermUnavailable,
    tableOfAuthoritiesUnavailable: legal.tableOfAuthoritiesUnavailable,
    tableOfAuthoritiesUpdateUnavailable:
      legal.tableOfAuthoritiesUpdateUnavailable,
    crossReferenceUnavailable,
    crossReferenceTargets,
    pageNumberUnavailable,
    footnoteUnavailable,
    tableOfContentsUnavailable,
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
    markDefinedTerm: legal.markDefinedTerm,
    insertTableOfAuthorities: legal.insertTableOfAuthorities,
    updateTableOfAuthorities: legal.updateTableOfAuthorities,
    insertCrossReference(targetParagraphId: string): StructuralInsertOutcome {
      if (crossReferenceUnavailable || !paragraphId || offset == null) {
        return {
          inserted: false,
          reason: crossReferenceUnavailable ?? 'No anchor',
        }
      }
      if (targetParagraphId === paragraphId) {
        return {
          inserted: false,
          reason: 'A reference cannot point at the paragraph holding it.',
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
    insertFootnote(): FootnoteInsertOutcome {
      if (footnoteUnavailable || !paragraphId || offset == null) {
        return {
          inserted: false,
          reason: footnoteUnavailable ?? 'No anchor',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'footnote',
        paragraphId,
        offset,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That footnote cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return {
        inserted: true,
        noteParagraphId: footnoteNoteParagraphId(draft),
      }
    },
    insertPageNumber(): StructuralInsertOutcome {
      if (pageNumberUnavailable || !paragraphId || offset == null) {
        return {
          inserted: false,
          reason: pageNumberUnavailable ?? 'No anchor',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'page-number',
        paragraphId,
        offset,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That page number cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
    insertTableOfContents(): StructuralInsertOutcome {
      if (tableOfContentsUnavailable || !paragraphId || offset == null) {
        return {
          inserted: false,
          reason: tableOfContentsUnavailable ?? 'No anchor',
        }
      }
      const draft: StructuralDraft = {
        id: crypto.randomUUID(),
        kind: 'table-of-contents',
        paragraphId,
        offset,
      }
      if (!structuralDraftSchema.safeParse(draft).success) {
        return {
          inserted: false,
          reason: 'That table of contents cannot be held as a draft.',
        }
      }
      setStructures((current) => [...current, draft])
      return { inserted: true }
    },
  }
}
