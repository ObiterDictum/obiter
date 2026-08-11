import { z } from 'zod'

import { isValidXmlText } from './xml-text'

export const DOCUMENT_EDIT_ID_MAX_LENGTH = 255
export const DOCUMENT_EDIT_TEXT_MAX_LENGTH = 1_000_000
export const DOCUMENT_EDIT_OPERATION_MAX_COUNT = 100

const editIdSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_ID_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, {
    message: 'Document edit identifiers must not be blank.',
  })

const editTextSchema = z
  .string()
  .max(DOCUMENT_EDIT_TEXT_MAX_LENGTH)
  .refine(isValidXmlText, {
    message: 'Document edit text contains an unsupported XML character.',
  })

const styleIdSchema = editIdSchema.nullable()

export const documentEditOperationSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('replace_run_text'),
      runId: editIdSchema,
      text: editTextSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('set_run_style'),
      runId: editIdSchema,
      styleId: styleIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('set_paragraph_style'),
      paragraphId: editIdSchema,
      styleId: styleIdSchema,
    })
    .strict(),
  z
    .object({
      type: z.literal('insert_paragraph_after'),
      paragraphId: editIdSchema,
      text: editTextSchema,
      styleId: styleIdSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('delete_paragraph'),
      paragraphId: editIdSchema,
    })
    .strict(),
])
export type DocumentEditOperation = z.infer<typeof documentEditOperationSchema>

export const documentEditOperationsSchema = z
  .array(documentEditOperationSchema)
  .min(1)
  .max(DOCUMENT_EDIT_OPERATION_MAX_COUNT)

export const documentEditRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    operations: documentEditOperationsSchema,
    trackChanges: z.boolean().optional().default(false),
  })
  .strict()
export type DocumentEditRequest = z.infer<typeof documentEditRequestSchema>

export const documentEditResponseSchema = z
  .object({
    documentId: editIdSchema,
    versionId: editIdSchema,
    versionNumber: z.number().int().positive(),
  })
  .strict()
export type DocumentEditResponse = z.infer<typeof documentEditResponseSchema>
