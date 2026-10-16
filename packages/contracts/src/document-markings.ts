import { z } from 'zod'

import { editIdSchema } from './document-edit-shared'

/**
 * Document classifications and markings (E12). They are document-level
 * metadata — product labels, not legal determinations — persisted inside the
 * version's own OOXML package (`docProps/custom.xml`) so they travel with the
 * immutable version through save, reload and export rather than living in
 * mutable document state. A new marking therefore commits a new version, the
 * same shape as a tracked-change decision.
 *
 * `documentKind` is the ribbon's Document type list. Values written before a
 * kind was introduced parse back as `null` only when absent; an unknown
 * stored value stays a string so the surface can show it rather than lose it.
 */
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

/**
 * The wire carries the stored kind as a plain string so a value written by a
 * newer deployment — or by another tool editing custom properties — reads
 * back honestly instead of failing model validation. Surfaces narrow it to
 * `DocumentKind` before offering it as a choice.
 */
export const documentMarkingsWireSchema = z
  .object({
    documentKind: z.string().min(1).nullable(),
    draft: z.boolean(),
    privileged: z.boolean(),
    withoutPrejudice: z.boolean(),
  })
  .strict()
export type DocumentMarkingsWire = z.infer<typeof documentMarkingsWireSchema>

/**
 * The markings state a parsed package carries. When the custom-properties
 * part is present but cannot be read honestly — ambiguous product
 * properties, a malformed part, competing declarations — the flags fall back
 * to unset and `unreadable` names the failure rather than hiding it. Foreign
 * properties that are malformed but unrelated to the product's own names do
 * not flip the flag: they are not markings this build wrote or can claim.
 * Marking *writes* still fail closed on every ambiguity.
 */
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

/**
 * The update request takes the wire shape, not the kind enum: a document
 * carrying a kind this deployment does not list must keep that value when a
 * flag toggles, rather than failing validation or silently clearing it.
 */
export const documentMarkingsRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    markings: documentMarkingsWireSchema,
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
