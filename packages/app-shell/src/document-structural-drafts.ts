import { z } from 'zod'
import {
  DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH,
  DOCUMENT_EDIT_IMAGE_DIMENSION_MAX,
  DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH,
  DOCUMENT_EDIT_TABLE_MAX_COLUMNS,
  DOCUMENT_EDIT_TABLE_MAX_ROWS,
  documentEditHyperlinkTargetSchema,
  documentEditImageContentTypeSchema,
  type DocumentEditImageContentType,
  type DocumentEditOperation,
  type DocumentTextRunWire,
} from '@obiter/contracts'

/**
 * A structural insertion the workspace holds before save: a body-level table
 * after a stored paragraph, or an inline picture at a caret offset. Unlike a
 * `LocalInsert` these are not paragraphs the user types into — a table cell's
 * paragraphs stay outside the editable flow — so they get their own draft
 * slot, folded into the painted model by `document-structure-fold`.
 */
export type StructuralTableDraft = {
  id: string
  kind: 'table'
  paragraphId: string
  rows: number
  columns: number
}

export type StructuralImageDraft = {
  id: string
  kind: 'image'
  paragraphId: string
  offset: number
  contentType: DocumentEditImageContentType
  dataBase64: string
  widthPx: number
  heightPx: number
  name: string
}

/**
 * A pending range mark over `[from, to)` of a stored paragraph's painted
 * text. It carries the link target rather than a model change: nothing is
 * folded into the painted runs, so `structuralLinkOverlays` paints it as an
 * overlay range and the save writer wraps the same range in `w:hyperlink`.
 * The range is fixed at creation; later typing does not remap it, the same
 * treatment a pending picture's offset gets.
 */
export type StructuralLinkDraft = {
  id: string
  kind: 'link'
  paragraphId: string
  from: number
  to: number
  target: string
}

/**
 * A pending `REF` field at `offset` in `paragraphId`, pointing at the
 * bookmark the writer ensures on `targetParagraphId`. Pending paint shows a
 * zero-width marker at the offset — the field's result text exists only in
 * the saved OOXML, never in the editable text stream.
 */
export type StructuralCrossReferenceDraft = {
  id: string
  kind: 'cross-reference'
  paragraphId: string
  offset: number
  targetParagraphId: string
}

/**
 * A pending `PAGE` field at `offset` in `paragraphId`. Like the
 * cross-reference it paints as a zero-width marker — the page number exists
 * only in the saved OOXML and in the margin band's resolved paint, never in
 * the editable text stream.
 */
export type StructuralPageNumberDraft = {
  id: string
  kind: 'page-number'
  paragraphId: string
  offset: number
}

/**
 * A pending `w:footnoteReference` at `offset` in `paragraphId`, whose note
 * body is a paragraph the footnotes story folds in for paint. The note's own
 * text is typed into that paragraph like any pending edit — it is held as
 * extra runs keyed by `footnoteNoteParagraphId`, not on the draft — and the
 * save operation carries it as the entry's paragraph text.
 */
export type StructuralFootnoteDraft = {
  id: string
  kind: 'footnote'
  paragraphId: string
  offset: number
}

/**
 * A pending `TOC` field at `offset` in `paragraphId` — the one draft whose
 * fold is multi-paragraph: the painted model splits the anchor into head
 * and tail around one entry paragraph per document heading, captured when
 * the fold runs, exactly as the save writer captures them when the batch
 * applies. The draft itself is still only a placement: entry text, page
 * references and `_Toc` bookmarks are all generated, never held.
 */
export type StructuralTableOfContentsDraft = {
  id: string
  kind: 'table-of-contents'
  paragraphId: string
  offset: number
}

/**
 * The paragraph id the pending footnote's note body folds under. It is not a
 * stored paragraph and never becomes one: the note's own `w14` id is only
 * allocated by the save writer.
 */
export function footnoteNoteParagraphId(draft: { id: string }) {
  return `${draft.id}:note`
}

export type StructuralDraft =
  | StructuralTableDraft
  | StructuralImageDraft
  | StructuralLinkDraft
  | StructuralCrossReferenceDraft
  | StructuralPageNumberDraft
  | StructuralFootnoteDraft
  | StructuralTableOfContentsDraft

/**
 * The persisted form of a structural draft, bounded to exactly the fields the
 * save serialises. E2: a persisted draft that fails to parse is silently
 * deleted, so the schema accepts nothing the operation cannot carry and the
 * state carries nothing the schema will not read back.
 */
export const structuralDraftSchema = z.discriminatedUnion('kind', [
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('table'),
      paragraphId: z.string().min(1),
      rows: z.number().int().min(1).max(DOCUMENT_EDIT_TABLE_MAX_ROWS),
      columns: z.number().int().min(1).max(DOCUMENT_EDIT_TABLE_MAX_COLUMNS),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('image'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
      contentType: documentEditImageContentTypeSchema,
      dataBase64: z.string().min(1).max(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH),
      widthPx: z.number().int().min(1).max(DOCUMENT_EDIT_IMAGE_DIMENSION_MAX),
      heightPx: z.number().int().min(1).max(DOCUMENT_EDIT_IMAGE_DIMENSION_MAX),
      name: z.string().min(1).max(DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('link'),
      paragraphId: z.string().min(1),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      target: documentEditHyperlinkTargetSchema,
    })
    .strict()
    .refine((draft) => draft.from < draft.to, {
      message: 'from and to must form a non-empty forward range.',
    }),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('cross-reference'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
      targetParagraphId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('page-number'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('footnote'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('table-of-contents'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
    })
    .strict(),
])

/**
 * The persisted `structures` field: a malformed slot is dropped on its own
 * rather than failing the whole snapshot, so unrelated work — typed drafts
 * especially — survives a slot the writer no longer produces.
 */
export const structuralDraftsFieldSchema = z
  .array(z.unknown())
  .optional()
  .default([])
  .transform((entries): StructuralDraft[] =>
    entries.filter(
      (entry): entry is StructuralDraft =>
        structuralDraftSchema.safeParse(entry).success,
    ),
  )

/** The save operations the covered structural drafts produce, in draft order. */
export function structuralEditOperations(
  structures: readonly StructuralDraft[],
  deletedIds: ReadonlySet<string>,
  drafts: Record<string, string> = {},
  extraRuns: Record<string, DocumentTextRunWire[]> = {},
): DocumentEditOperation[] {
  const operations: DocumentEditOperation[] = []
  for (const structure of structures) {
    if (deletedIds.has(structure.paragraphId)) continue
    if (structure.kind === 'table') {
      operations.push({
        type: 'insert_table',
        paragraphId: structure.paragraphId,
        rows: structure.rows,
        columns: structure.columns,
      })
      continue
    }
    if (structure.kind === 'image') {
      operations.push({
        type: 'insert_image',
        paragraphId: structure.paragraphId,
        offset: structure.offset,
        contentType: structure.contentType,
        dataBase64: structure.dataBase64,
        widthPx: structure.widthPx,
        heightPx: structure.heightPx,
        name: structure.name,
      })
      continue
    }
    if (structure.kind === 'link') {
      operations.push({
        type: 'set_hyperlink',
        paragraphId: structure.paragraphId,
        from: structure.from,
        to: structure.to,
        target: structure.target,
      })
      continue
    }
    if (structure.kind === 'page-number') {
      operations.push({
        type: 'insert_page_number',
        paragraphId: structure.paragraphId,
        offset: structure.offset,
      })
      continue
    }
    if (structure.kind === 'footnote') {
      // The note's text is the typed draft held against the folded note
      // paragraph — the same effective-text merge the text operations use.
      const text = (extraRuns[footnoteNoteParagraphId(structure)] ?? [])
        .map((run) => drafts[run.id] ?? run.text)
        .join('')
      operations.push({
        type: 'insert_footnote',
        paragraphId: structure.paragraphId,
        offset: structure.offset,
        text,
      })
      continue
    }
    if (structure.kind === 'table-of-contents') {
      operations.push({
        type: 'insert_table_of_contents',
        paragraphId: structure.paragraphId,
        offset: structure.offset,
      })
      continue
    }
    if (deletedIds.has(structure.targetParagraphId)) continue
    operations.push({
      type: 'insert_cross_reference',
      paragraphId: structure.paragraphId,
      offset: structure.offset,
      targetParagraphId: structure.targetParagraphId,
    })
  }
  return operations
}
