import { z } from 'zod'

import { isValidXmlText } from './xml-text'
import {
  characterOffsetSchema,
  editIdSchema,
  editTextSchema,
} from './document-edit-shared'

export const DOCUMENT_EDIT_TABLE_MAX_ROWS = 64
export const DOCUMENT_EDIT_TABLE_MAX_COLUMNS = 64

export const DOCUMENT_EDIT_IMAGE_DATA_MAX_LENGTH = 8_388_608
export const DOCUMENT_EDIT_IMAGE_DIMENSION_MAX = 16_384
export const DOCUMENT_EDIT_IMAGE_NAME_MAX_LENGTH = 255

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

export function imageExtensionForContentType(
  contentType: DocumentEditImageContentType,
) {
  return IMAGE_EXTENSION_BY_CONTENT_TYPE[contentType]
}

export const DOCUMENT_EDIT_HYPERLINK_TARGET_MAX_LENGTH = 2_048

const HYPERLINK_SCHEMES = new Set(['http:', 'https:', 'mailto:'])

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

const BASE64_PADDING = 0x3d

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

export const insertImageOperationSchema = z
  .object({
    type: z.literal('insert_image'),
    paragraphId: editIdSchema,
    offset: characterOffsetSchema,
    contentType: documentEditImageContentTypeSchema,
    dataBase64: imageDataSchema,
    widthPx: imageDimensionSchema,
    heightPx: imageDimensionSchema,
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

export const markDefinedTermOperationSchema = z
  .object({
    type: z.literal('mark_defined_term'),
    paragraphId: editIdSchema,
    from: characterOffsetSchema,
    to: characterOffsetSchema,
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
export type DocumentEditMarkDefinedTermOperation = z.infer<
  typeof markDefinedTermOperationSchema
>

export const insertPageNumberOperationSchema = z
  .object({
    type: z.literal('insert_page_number'),
    paragraphId: editIdSchema,
    offset: characterOffsetSchema,
  })
  .strict()
export type DocumentEditInsertPageNumberOperation = z.infer<
  typeof insertPageNumberOperationSchema
>

export const insertFootnoteOperationSchema = z
  .object({
    type: z.literal('insert_footnote'),
    paragraphId: editIdSchema,
    offset: characterOffsetSchema,
    text: editTextSchema,
  })
  .strict()
export type DocumentEditInsertFootnoteOperation = z.infer<
  typeof insertFootnoteOperationSchema
>

export const DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES = 500

export const insertTableOfContentsOperationSchema = z
  .object({
    type: z.literal('insert_table_of_contents'),
    paragraphId: editIdSchema,
    offset: characterOffsetSchema,
  })
  .strict()
export type DocumentEditInsertTableOfContentsOperation = z.infer<
  typeof insertTableOfContentsOperationSchema
>

export const DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES = 500
export const DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES = 2_000

export const insertTableOfAuthoritiesOperationSchema = z
  .object({
    type: z.literal('insert_table_of_authorities'),
    paragraphId: editIdSchema,
    offset: characterOffsetSchema,
  })
  .strict()
export type DocumentEditInsertTableOfAuthoritiesOperation = z.infer<
  typeof insertTableOfAuthoritiesOperationSchema
>

export const updateTableOfAuthoritiesOperationSchema = z
  .object({
    type: z.literal('update_table_of_authorities'),
    paragraphId: editIdSchema,
  })
  .strict()
export type DocumentEditUpdateTableOfAuthoritiesOperation = z.infer<
  typeof updateTableOfAuthoritiesOperationSchema
>
