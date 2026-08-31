import { z } from 'zod'

import { isValidXmlText } from './xml-text'

export const DOCUMENT_EDIT_ID_MAX_LENGTH = 255
export const DOCUMENT_EDIT_TEXT_MAX_LENGTH = 1_000_000
export const DOCUMENT_EDIT_OPERATION_MAX_COUNT = 100
export const DOCUMENT_EDIT_RUN_MAX_COUNT = 4_096

export const editIdSchema = z
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

const editRunSchema = z
  .object({
    text: editTextSchema,
    styleId: styleIdSchema.optional(),
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
  })
  .strict()
export type DocumentEditRun = z.infer<typeof editRunSchema>

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
      type: z.literal('set_run_emphasis'),
      runId: editIdSchema,
      bold: z.boolean().nullable().optional(),
      italic: z.boolean().nullable().optional(),
      underline: z.boolean().nullable().optional(),
    })
    .strict()
    .superRefine((operation, context) => {
      if (
        operation.bold == null &&
        operation.italic == null &&
        operation.underline == null
      ) {
        context.addIssue({
          code: 'custom',
          path: ['bold'],
          message: 'At least one emphasis flag must be set.',
        })
      }
    }),
  z
    .object({
      type: z.literal('set_paragraph_numbering'),
      paragraphId: editIdSchema,
      numId: editIdSchema.nullable(),
      ilvl: z.number().int().min(0).max(8).optional(),
    })
    .strict()
    .superRefine((operation, context) => {
      if (operation.numId !== null && operation.ilvl === undefined) {
        context.addIssue({
          code: 'custom',
          path: ['ilvl'],
          message: 'ilvl is required when numId is set.',
        })
      }
    }),
  z
    .object({
      type: z.literal('insert_paragraph_after'),
      paragraphId: editIdSchema,
      text: editTextSchema.optional(),
      runs: z
        .array(editRunSchema)
        .min(1)
        .max(DOCUMENT_EDIT_RUN_MAX_COUNT)
        .optional(),
      styleId: styleIdSchema.optional(),
    })
    .strict()
    .superRefine((operation, context) => {
      const hasText = operation.text !== undefined
      const hasRuns = operation.runs !== undefined
      if (hasText === hasRuns) {
        context.addIssue({
          code: 'custom',
          path: hasText ? ['runs'] : ['text'],
          message: 'insert_paragraph_after requires text or runs, not both.',
        })
        return
      }
      if (!operation.runs) return
      const total = operation.runs.reduce(
        (sum, run) => sum + run.text.length,
        0,
      )
      if (total > DOCUMENT_EDIT_TEXT_MAX_LENGTH) {
        context.addIssue({
          code: 'custom',
          path: ['runs'],
          message: 'Inserted run text exceeds the document edit text limit.',
        })
      }
    }),
  z
    .object({
      type: z.literal('delete_paragraph'),
      paragraphId: editIdSchema,
    })
    .strict(),
])
export type DocumentEditOperation = z.infer<typeof documentEditOperationSchema>

export function insertParagraphRuns(
  operation: Extract<DocumentEditOperation, { type: 'insert_paragraph_after' }>,
): DocumentEditRun[] {
  return operation.runs ?? [{ text: operation.text ?? '' }]
}

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
