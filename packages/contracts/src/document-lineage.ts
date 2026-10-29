import { z } from 'zod'

const lineageIdSchema = z.string().min(1).max(255)

export const documentLineageSegmentSchema = z
  .object({
    fromRunId: lineageIdSchema.nullable(),
    fromOffset: z.number().int().nonnegative(),
    toOffset: z.number().int().nonnegative(),
  })
  .strict()
  .superRefine((segment, context) => {
    if (segment.toOffset < segment.fromOffset) {
      context.addIssue({
        code: 'custom',
        path: ['toOffset'],
        message: 'A lineage segment range must not run backwards.',
      })
    }
    if (segment.fromRunId === null && segment.fromOffset !== 0) {
      context.addIssue({
        code: 'custom',
        path: ['fromOffset'],
        message: 'Inserted content starts at offset zero.',
      })
    }
  })
export type DocumentLineageSegment = z.infer<
  typeof documentLineageSegmentSchema
>

export const documentLineageRunSchema = z
  .object({
    runIndex: z.number().int().nonnegative(),
    segments: z.array(documentLineageSegmentSchema).min(1),
  })
  .strict()
export type DocumentLineageRun = z.infer<typeof documentLineageRunSchema>

export const documentParagraphLineageSchema = z
  .object({
    fromParagraphId: lineageIdSchema.nullable(),
    toParagraphId: lineageIdSchema.nullable(),
    insertedByOperation: z.number().int().nonnegative().optional(),
    insertedByIntent: lineageIdSchema.optional(),
    trackedInsertChangeIds: z.array(lineageIdSchema).min(1).optional(),
    runs: z.array(documentLineageRunSchema),
  })
  .strict()
  .superRefine((paragraph, context) => {
    if (paragraph.fromParagraphId === null) {
      if (paragraph.toParagraphId === null) {
        context.addIssue({
          code: 'custom',
          path: ['toParagraphId'],
          message: 'An inserted paragraph must have a result id.',
        })
      }
      return
    }
    if (paragraph.toParagraphId === null && paragraph.runs.length > 0) {
      context.addIssue({
        code: 'custom',
        path: ['runs'],
        message: 'A deleted paragraph cannot carry result runs.',
      })
    }
  })
export type DocumentParagraphLineage = z.infer<
  typeof documentParagraphLineageSchema
>

export const documentLineageReversalSchema = z
  .object({
    operation: z.number().int().nonnegative(),
    fromRunId: lineageIdSchema.nullable(),
    fromParagraphId: lineageIdSchema.nullable(),
    rejectOoxmlIds: z.array(lineageIdSchema).min(1),
  })
  .strict()
  .superRefine((reversal, context) => {
    if (reversal.fromRunId === null && reversal.fromParagraphId === null) {
      context.addIssue({
        code: 'custom',
        path: ['fromRunId'],
        message: 'A reversal must name a base run or paragraph.',
      })
    }
  })
export type DocumentLineageReversal = z.infer<
  typeof documentLineageReversalSchema
>

export const documentVersionLineageSchema = z
  .object({
    version: z.literal(1),
    baseVersionId: lineageIdSchema,
    versionId: lineageIdSchema,
    acceptedOperations: z.array(z.number().int().nonnegative()),
    paragraphs: z.array(documentParagraphLineageSchema),
    reversals: z.array(documentLineageReversalSchema).optional(),
  })
  .strict()
export type DocumentVersionLineage = z.infer<
  typeof documentVersionLineageSchema
>
