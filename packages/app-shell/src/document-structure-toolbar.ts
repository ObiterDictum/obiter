import { PAGE_STORY_KINDS, type DocumentModelWire } from '@obiter/contracts'
import {
  isTableOfContentsHeading,
  tableOfContentsAnchorBlock,
  tableOfContentsHeadingsBlock,
} from './document-toc-availability'
import type { ParagraphRange } from './document-format-toolbar'
import { documentLegalToolbar } from './document-legal-toolbar'
import type { TableOfAuthoritiesFacts } from './document-legal-toolbar'
import { documentStory, editableParagraph } from './document-model-text'
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

/**
 * Why an insert was refused after the picker already read the file. The draft
 * is validated against the persisted schema before it is accepted: an
 * unparseable structure slot would delete itself — and every sibling draft —
 * on the next restore, so an invalid draft is impossible to create.
 */
export type StructuralInsertOutcome =
  { inserted: true } | { inserted: false; reason: string }

/**
 * A footnote insertion names the folded paragraph the caret should move to —
 * the pending note body — so the ribbon can open the footnote story and land
 * the caret where the note's text is typed.
 */
export type FootnoteInsertOutcome =
  | { inserted: true; noteParagraphId: string }
  | { inserted: false; reason: string }

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
  setStructures,
  toaFacts,
}: {
  paragraphId: string | null
  /** The stored model — a pending paragraph or cell wire is not an anchor. */
  model: DocumentModelWire | undefined
  /**
   * The painted model — headings a pending fold already splices count toward
   * the entries a table of contents will capture, so availability reads the
   * same paragraphs the save does.
   */
  painted?: DocumentModelWire | undefined
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
  /**
   * The citations the painted flow reports over stored body paragraphs —
   * memoised by the caller so the mark pass does not rescan the document
   * per render.
   */
  toaFacts: TableOfAuthoritiesFacts
}) {
  const story = model ? documentStory(model) : undefined
  // The same run-level rule the save plan enforces: the reason names the
  // earlier draft a candidate cannot compose with.
  const conflictWith = (candidate: StructuralPlacement) => {
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
  // A footnote is a body-only splice like a picture, plus the table-cell rule
  // a block shares: the writer anchors the reference in `word/document.xml`,
  // and a note on cell text has no entry to hang from in this slice.
  const footnoteUnavailable =
    baseUnavailable ??
    (inTableCell
      ? 'A table cell cannot hold a footnote'
      : offset == null || !paragraphId
        ? 'Place the cursor in the paragraph text to insert a footnote'
        : conflictWith({ kind: 'footnote', paragraphId, offset }))
  // A page number anchors in whichever story a `PAGE` field resolves in —
  // body, header or footer — not just the body. A note story has no page of
  // its own, so a caret there refuses honestly rather than drafting a field
  // the save plan must block. A selection has no single insertion point,
  // and a pending insert has no server id yet.
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
  // A table of contents is a body splice like a table — plus the entries it
  // captures: a document with no heading the `\o "1-3"` switch covers drafts
  // a field the writer must refuse, and the stored `w:sectPr` paragraph ends
  // its section so it cannot split. The heading count reads the painted
  // story restricted to stored paragraphs: a pending insert carries its
  // style on the wire but cannot hold the stored bookmark an entry needs,
  // and the writer skips it the same way.
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
  // The legal-document controls — the defined-term mark and the table of
  // authorities — own their own module: same caret-level predicates as the
  // splice above, a different set of facts under them.
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
    setStructures,
  })
  // A bookmark can wrap any stored paragraph, including a table cell's, so the
  // chooser lists the whole story minus paragraphs marked for deletion — and
  // minus the host paragraph, whose bookmark would wrap the field itself.
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
