import { z } from 'zod'

/**
 * The scalar bounds and primitive schemas every document-edit operation
 * module shares. They live in a leaf so `document-edit-structural.ts` can use
 * them without `document-edit.ts` importing it back through the operation
 * union — a circular module pair would leave the schemas in the temporal
 * dead zone when the union evaluates.
 */
export const DOCUMENT_EDIT_ID_MAX_LENGTH = 255
export const DOCUMENT_EDIT_TEXT_MAX_LENGTH = 1_000_000

export const editIdSchema = z
  .string()
  .min(1)
  .max(DOCUMENT_EDIT_ID_MAX_LENGTH)
  .refine((value) => value.trim().length > 0, {
    message: 'Document edit identifiers must not be blank.',
  })

export const characterOffsetSchema = z
  .number()
  .int()
  .min(0)
  .max(DOCUMENT_EDIT_TEXT_MAX_LENGTH)
