import { z } from 'zod'

import { isValidXmlText } from './xml-text'
import {
  characterOffsetSchema,
  editIdSchema,
  editTextSchema,
} from './document-edit-shared'

/** Bounds for a user-inserted table; the writer emits empty grid cells. */
export const DOCUMENT_EDIT_TABLE_MAX_ROWS = 64
export const DOCUMENT_EDIT_TABLE_MAX_COLUMNS = 64

/**
 * The largest image the contract accepts, as base64 text (8 MiB, encoding at
 * most 6 MiB of raster). The edit route admits a 12 MiB request body, so a
 * maximum-sized picture still leaves room for the rest of the batch.
 */
export const DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH = 8_388_608
export const DOCUMENT_EDIT_IMAGE_DIMENSION_MAX = 16_384
export const DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH = 255

/**
 * The raster formats the reader paints and Word renders without probing.
 * The package image index knows more (svg, tiff, emf, wmf), but an inserted
 * picture must display in the editor and in Word, so the set stays narrow.
 */
export const documentEditImageContentTypeSchema = z.enum([
  'image/png',
  'image/jpeg',
  'image/gif',
  'image/bmp',
])
export type DocumentEditImageContentType = z.infer<
  typeof documentEditImageContentTypeSchema
>

const IMAGE_EXTENSION_BY_CONTENT_TYPE = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/bmp': 'bmp',
} satisfies Record<DocumentEditImageContentType, string>

/**
 * The package-part extension an inserted picture's content type carries —
 * contract-level because both the package writer and the client draft schema
 * (which must not depend on the writer) name parts with it.
 */
export function imageExtensionForContentType(
  contentType: DocumentEditImageContentType,
) {
  return IMAGE_EXTENSION_BY_CONTENT_TYPE[contentType]
}

/**
 * The longest hyperlink target the contract accepts. Two kilobytes covers any
 * legitimate address while keeping a hostile client from writing an unbounded
 * string into the package relationships.
 */
export const DOCUMENT_EDIT_HYPERLINK_TARGET_MAX_LENGTH = 2_048

const HYPERLINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

/**
 * An external hyperlink target: a URL in a scheme Word and the reader can
 * open without executing script. `javascript:` and `data:` URLs are refused
 * here rather than written into the package and opened by Word.
 */
function isHyperlinkTarget(value: string): boolean {
  if (value !== value.trim()) return false
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return false
  }
  if (!HYPERLINK_SCHEMES.has(parsed.protocol)) return false
  if (parsed.protocol === 'mailto:') return parsed.pathname.length > 0
  return parsed.host.length > 0
}

export const documentEditHyperlinkTargetSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_HYPERLINK_TARGET_MAX_LENGTH)
  .refine(isHyperlinkTarget, {
    message:
      'Hyperlink target must be an http, https or mailto URL; other schemes are not accepted.',
  })

const BASE64_PADDING = 0x3d // '='

/**
 * Standard padded-base64 membership, checked in one pass. A regex alternative
 * blows the call stack on the multi-megabyte strings this schema legitimately
 * carries; a linear scan does not backtrack and costs one read per character.
 */
function isBase64(value: string): boolean {
  const length = value.length
  if (length === 0 || length % 4 !== 0) return false
  let body = length
  if (value.charCodeAt(body - 1) === BASE64_PADDING) body -= 1
  if (value.charCodeAt(body - 1) === BASE64_PADDING) body -= 1
  for (let index = 0; index < body; index += 1) {
    const code = value.charCodeAt(index)
    const alphanumeric =
      (code >= 0x30 && code <= 0x39) ||
      (code >= 0x41 && code <= 0x5a) ||
      (code >= 0x61 && code <= 0x7a)
    if (!alphanumeric && code !== 0x2b && code !== 0x2f) return false
  }
  return true
}

const imageDataSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH)
  .refine(isBase64, { message: 'Image data must be base64.' })

const imageDimensionSchema = z
  .number()
  .int()
  .min(1)
  .max(DOCUMENT_EDIT_IMAGE_DIMENSION_MAX)

/**
 * A body-level `w:tbl` spliced directly after `paragraphId`. The anchor must
 * name a stored body paragraph — not a table cell, a pending insert or a
 * header/footer paragraph — which the writer checks, not just the client.
 */
export const insertTableOperationSchema = z
  .object({
    type: z.literal('insert_table'),
    paragraphId: editIdSchema,
    rows: z.number().int().min(1).max(DOCUMENT_EDIT_TABLE_MAX_ROWS),
    columns: z.number().int().min(1).max(DOCUMENT_EDIT_TABLE_MAX_COLUMNS),
  })
  .strict()
export type DocumentEditInsertTableOperation = z.infer<
  typeof insertTableOperationSchema
>

/**
 * An inline `w:drawing` picture spliced at `offset` in `paragraphId`. The
 * image bytes become a new `word/media` package part joined to the paragraph
 * run by a fresh `r:embed` relationship.
 */
export const insertImageOperationSchema = z
  .object({
    type: z.literal('insert_image'),
    paragraphId: editIdSchema,
    /** Caret offset in the paragraph's effective text. */
    offset: characterOffsetSchema,
    contentType: documentEditImageContentTypeSchema,
    dataBase64: imageDataSchema,
    /** Display size in CSS pixels; the writer converts to EMU. */
    widthPx: imageDimensionSchema,
    heightPx: imageDimensionSchema,
    /** The picture's display name, written to `wp:docPr`. */
    name: z
      .string()
      .min(1)
      .max(DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH)
      .refine(isValidXmlText, {
        message: 'Image name contains an unsupported XML character.',
      }),
  })
  .strict()
export type DocumentEditInsertImageOperation = z.infer<
  typeof insertImageOperationSchema
>

/**
 * A range mark over `[from, to)` of `paragraphId`'s effective text. It
 * inserts no text, so it cannot shift an offset: the runs the range covers
 * are wrapped in `w:hyperlink` joined to a new external relationship, or —
 * with `target: null` — the `w:hyperlink` covering the range is unwrapped
 * and its relationship dropped, the text surviving byte-for-byte.
 */
export const setHyperlinkOperationSchema = z
  .object({
    type: z.literal('set_hyperlink'),
    paragraphId: editIdSchema,
    from: characterOffsetSchema,
    to: characterOffsetSchema,
    target: documentEditHyperlinkTargetSchema.nullable(),
  })
  .strict()
  .superRefine((operation, context) => {
    if (operation.from >= operation.to) {
      context.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'from and to must form a non-empty forward range.',
      })
    }
  })
export type DocumentEditSetHyperlinkOperation = z.infer<
  typeof setHyperlinkOperationSchema
>

/**
 * A `REF` field spliced at `offset` in `paragraphId`, pointing at a bookmark
 * the writer ensures around `targetParagraphId`'s content. The bookmark name
 * is derived deterministically from the target's wire id, so the client never
 * invents names.
 */
export const insertCrossReferenceOperationSchema = z
  .object({
    type: z.literal('insert_cross_reference'),
    paragraphId: editIdSchema,
    offset: characterOffsetSchema,
    targetParagraphId: editIdSchema,
  })
  .strict()
export type DocumentEditInsertCrossReferenceOperation = z.infer<
  typeof insertCrossReferenceOperationSchema
>

/**
 * A `PAGE` field spliced at `offset` in `paragraphId`. The field carries an
 * empty stored result; the reader resolves the number at paint time and Word
 * recomputes it on repagination, so the operation takes no value. `paragraphId`
 * may name a paragraph in any editable story — body, header or footer — and
 * the writer resolves the part the anchor lives in.
 */
export const insertPageNumberOperationSchema = z
  .object({
    type: z.literal('insert_page_number'),
    paragraphId: editIdSchema,
    /** Caret offset in the paragraph's effective text. */
    offset: characterOffsetSchema,
  })
  .strict()
export type DocumentEditInsertPageNumberOperation = z.infer<
  typeof insertPageNumberOperationSchema
>

/**
 * A `w:footnoteReference` run spliced at `offset` in `paragraphId`, plus the
 * `w:footnote` entry the reference resolves to: `text` is the note's own body
 * text, written as one paragraph inside the entry. `paragraphId` must name a
 * body paragraph — a reference belongs in the main story — and the writer
 * checks that, not just the client.
 */
export const insertFootnoteOperationSchema = z
  .object({
    type: z.literal('insert_footnote'),
    paragraphId: editIdSchema,
    /** Caret offset in the paragraph's effective text. */
    offset: characterOffsetSchema,
    /** The footnote body's text, written as a single paragraph. */
    text: editTextSchema,
  })
  .strict()
export type DocumentEditInsertFootnoteOperation = z.infer<
  typeof insertFootnoteOperationSchema
>

/**
 * The most entries a written `TOC` field stores. The operation carries no
 * entry payload — headings are captured at save — so the writer is what
 * refuses a document whose heading count would write an unbounded field.
 */
export const DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES = 500

/**
 * A `TOC` field whose result is one paragraph per document heading, spliced
 * at `offset` in `paragraphId` — the first multi-paragraph generated
 * structure: the anchor splits into head and tail paragraphs around the
 * caret, the field's begin, instruction and separator open the first entry
 * paragraph between them, and the end marker opens the tail. The entries
 * are computed from the document's heading paragraphs when the save
 * applies the operation — a stored snapshot, never recomputed — so the
 * operation carries no entry payload. `paragraphId` must name a
 * body-level paragraph.
 */
export const insertTableOfContentsOperationSchema = z
  .object({
    type: z.literal('insert_table_of_contents'),
    paragraphId: editIdSchema,
    /** Caret offset in the paragraph's effective text. */
    offset: characterOffsetSchema,
  })
  .strict()
export type DocumentEditInsertTableOfContentsOperation = z.infer<
  typeof insertTableOfContentsOperationSchema
>
