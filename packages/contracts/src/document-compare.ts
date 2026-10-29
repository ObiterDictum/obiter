import { z } from 'zod'

import { editIdSchema } from './document-edit'
import { documentEditResponseSchema } from './document-edit-request'

export const DOCUMENT_COMPARISON_ENTRY_MAX_COUNT = 500
export const DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH = 400
export const DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT = 400
export const DOCUMENT_COMPARISON_NOTE_MAX_COUNT = 20

const versionRefSchema = z
  .object({
    versionId: documentEditResponseSchema.shape.versionId,
    versionNumber: documentEditResponseSchema.shape.versionNumber,
  })
  .strict()

export const documentComparisonSegmentSchema = z
  .object({
    kind: z.enum(['same', 'added', 'removed']),
    text: z.string().min(1),
  })
  .strict()
export type DocumentComparisonSegment = z.infer<
  typeof documentComparisonSegmentSchema
>

const paragraphFields = {
  storyPartName: z.string().min(1),
  paragraphId: z.string().min(1),
}

export const documentComparisonEntrySchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('added'),
      ...paragraphFields,
      text: z.string(),
      textTruncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('removed'),
      ...paragraphFields,
      text: z.string(),
      textTruncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('modified'),
      ...paragraphFields,
      segments: z
        .array(documentComparisonSegmentSchema)
        .min(1)
        .max(DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT),
    })
    .strict(),
  z
    .object({
      type: z.literal('formatted'),
      ...paragraphFields,
      text: z.string(),
      textTruncated: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal('story'),
      storyPartName: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal('package'),
      area: z.enum([
        'styles',
        'numbering',
        'relationships',
        'comments',
        'revisions',
        'package',
      ]),
    })
    .strict(),
])
export type DocumentComparisonEntry = z.infer<
  typeof documentComparisonEntrySchema
>

export const documentCompareResponseSchema = z
  .object({
    documentId: documentEditResponseSchema.shape.documentId,
    base: versionRefSchema,
    target: versionRefSchema,
    identical: z.boolean(),
    entries: z
      .array(documentComparisonEntrySchema)
      .max(DOCUMENT_COMPARISON_ENTRY_MAX_COUNT),
    entriesTruncated: z.boolean(),
    notes: z.array(z.string().min(1)).max(DOCUMENT_COMPARISON_NOTE_MAX_COUNT),
  })
  .strict()
export type DocumentCompareResponse = z.infer<
  typeof documentCompareResponseSchema
>

export const documentCompareQuerySchema = z
  .object({
    baseVersionId: editIdSchema,
    targetVersionId: editIdSchema,
  })
  .strict()
export type DocumentCompareQuery = z.infer<typeof documentCompareQuerySchema>
