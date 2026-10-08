import { z } from 'zod'

import { editIdSchema } from './document-edit'
import { documentEditResponseSchema } from './document-edit-request'

/**
 * A comparison never reports more than this many entries. Documents that
 * differ in more places are truncated — honest, and the response stays
 * bounded for documents at the 25 MB upload cap.
 */
export const DOCUMENT_COMPARISON_ENTRY_MAX_COUNT = 500
/** A paragraph preview never carries more than this many characters. */
export const DOCUMENT_COMPARISON_PREVIEW_MAX_LENGTH = 400
/** A modified paragraph's segment list never exceeds this bound. */
export const DOCUMENT_COMPARISON_SEGMENT_MAX_COUNT = 400
export const DOCUMENT_COMPARISON_NOTE_MAX_COUNT = 20

const versionRefSchema = z
  .object({
    versionId: documentEditResponseSchema.shape.versionId,
    versionNumber: documentEditResponseSchema.shape.versionNumber,
  })
  .strict()

/** One contiguous piece of a modified paragraph: kept, added or removed text. */
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
  /** The OOXML story part the paragraph lives in, e.g. `word/document.xml`. */
  storyPartName: z.string().min(1),
  paragraphId: z.string().min(1),
}

/**
 * One difference between two immutable versions. `modified` carries a
 * word-level segment diff; `formatted` means the paragraph text is identical
 * but its recorded formatting or internal run structure changed. `story`
 * marks a non-paragraph change inside a story part (tables, section
 * properties), including a part that exists on only one side; `package`
 * marks a change outside story paragraphs (styles, numbering, relationships,
 * tracked revisions, imported comments).
 */
export const documentComparisonEntrySchema = z.discriminatedUnion('type', [
  // `text` may be empty: a paragraph with no text runs is still a real
  // added/removed/formatted difference (e.g. a blank spacer or break holder).
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
    /**
     * True only when the two stored versions are byte-identical. Model-equal
     * versions whose package bytes differ report `false` and carry a note —
     * the comparison covers model content, and claiming the packages are the
     * same would overstate it.
     */
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

/** `?baseVersionId=`/`?targetVersionId=` share the version id contract. */
export const documentCompareQuerySchema = z
  .object({
    baseVersionId: editIdSchema,
    targetVersionId: editIdSchema,
  })
  .strict()
export type DocumentCompareQuery = z.infer<typeof documentCompareQuerySchema>
