import { z } from 'zod'

import { isValidXmlText } from './xml-text'

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

export function normaliseEditText(value: string) {
  return value.replace(/\r\n?/gu, '\n')
}

export const editTextSchema = z
  .string()
  .max(DOCUMENT_EDIT_TEXT_MAX_LENGTH)
  .refine(isValidXmlText, {
    message: 'Document edit text contains an unsupported XML character.',
  })
  .transform(normaliseEditText)
