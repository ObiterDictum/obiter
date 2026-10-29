import { z } from 'zod'

import { editIdSchema } from './document-edit-shared'

// Legal: Classifications and markings are product labels, not legal determinations. They live inside the version's own OOXML package so they travel with the immutable version rather than in mutable document state.
export const documentKindSchema = z.enum([
  'advice',
  'letter',
  'particulars',
  'defence',
  'witness',
  'skeleton',
  'order',
])
export type DocumentKind = z.infer<typeof documentKindSchema>

export const documentMarkingsSchema = z
  .object({
    documentKind: documentKindSchema.nullable(),
    draft: z.boolean(),
    privileged: z.boolean(),
    withoutPrejudice: z.boolean(),
  })
  .strict()
export type DocumentMarkings = z.infer<typeof documentMarkingsSchema>

export const documentMarkingsWireSchema = z
  .object({
    documentKind: z.string().min(1).nullable(),
    draft: z.boolean(),
    privileged: z.boolean(),
    withoutPrejudice: z.boolean(),
  })
  .strict()
export type DocumentMarkingsWire = z.infer<typeof documentMarkingsWireSchema>

export const documentMarkingsStateSchema = documentMarkingsWireSchema.extend({
  unreadable: z.literal(true).optional(),
})
export type DocumentMarkingsState = z.infer<typeof documentMarkingsStateSchema>

export const EMPTY_DOCUMENT_MARKINGS: DocumentMarkingsWire = {
  documentKind: null,
  draft: false,
  privileged: false,
  withoutPrejudice: false,
}

export const documentMarkingsRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    markings: documentMarkingsWireSchema,
    trackRevisions: z.boolean().optional(),
  })
  .strict()
export type DocumentMarkingsRequest = z.infer<
  typeof documentMarkingsRequestSchema
>

export const documentMarkingsResponseSchema = z
  .object({
    documentId: editIdSchema,
    versionId: editIdSchema,
    versionNumber: z.number().int().positive(),
    markings: documentMarkingsWireSchema,
  })
  .strict()
export type DocumentMarkingsResponse = z.infer<
  typeof documentMarkingsResponseSchema
>
