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

type StructuralTableDraft = {
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

export type StructuralLinkDraft = {
  id: string
  kind: 'link'
  paragraphId: string
  from: number
  to: number
  target: string
}

export type StructuralCrossReferenceDraft = {
  id: string
  kind: 'cross-reference'
  paragraphId: string
  offset: number
  targetParagraphId: string
}

type StructuralPageNumberDraft = {
  id: string
  kind: 'page-number'
  paragraphId: string
  offset: number
}

export type StructuralFootnoteDraft = {
  id: string
  kind: 'footnote'
  paragraphId: string
  offset: number
}

type StructuralTableOfContentsDraft = {
  id: string
  kind: 'table-of-contents'
  paragraphId: string
  offset: number
}

type StructuralTableOfAuthoritiesDraft = {
  id: string
  kind: 'table-of-authorities'
  paragraphId: string
  offset: number
}

type StructuralTableOfAuthoritiesRefreshDraft = {
  id: string
  kind: 'table-of-authorities-refresh'
  paragraphId: string
}

type StructuralDefinedTermDraft = {
  id: string
  kind: 'defined-term'
  paragraphId: string
  from: number
  to: number
  marked: string
}

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
  | StructuralTableOfAuthoritiesDraft
  | StructuralTableOfAuthoritiesRefreshDraft
  | StructuralDefinedTermDraft

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
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('table-of-authorities'),
      paragraphId: z.string().min(1),
      offset: z.number().int().min(0),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('table-of-authorities-refresh'),
      paragraphId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      id: z.string().min(1),
      kind: z.literal('defined-term'),
      paragraphId: z.string().min(1),
      from: z.number().int().min(0),
      to: z.number().int().min(0),
      marked: z.string().min(1).max(4_096),
    })
    .strict()
    .refine((draft) => draft.from < draft.to, {
      message: 'from and to must form a non-empty forward range.',
    }),
])

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
    if (structure.kind === 'table-of-authorities') {
      operations.push({
        type: 'insert_table_of_authorities',
        paragraphId: structure.paragraphId,
        offset: structure.offset,
      })
      continue
    }
    if (structure.kind === 'table-of-authorities-refresh') {
      operations.push({
        type: 'update_table_of_authorities',
        paragraphId: structure.paragraphId,
      })
      continue
    }
    if (structure.kind === 'defined-term') {
      operations.push({
        type: 'mark_defined_term',
        paragraphId: structure.paragraphId,
        from: structure.from,
        to: structure.to,
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
