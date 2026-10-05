import { z } from 'zod'

import { isValidXmlText } from './xml-text'
import { characterOffsetSchema, editIdSchema } from './document-edit-shared'

/** Bounds for a user-inserted table; the writer emits empty grid cells. */
export const DOCUMENT_EDIT_TABLE_MAX_ROWS = 64
export const DOCUMENT_EDIT_TABLE_MAX_COLUMNS = 64

/**
 * The largest image the contract accepts, as base64 text. The package limit
 * for one entry is 24 MiB uncompressed, so the base64 form cannot exceed
 * 24 MiB * 4/3 characters.
 */
export const DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH = 33_554_432
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

const imageDataSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH)
  .refine(
    (value) =>
      /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/u.test(
        value,
      ),
    { message: 'Image data must be base64.' },
  )

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
