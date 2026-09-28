import { z } from 'zod'

// Local id schema: importing document-edit's editIdSchema here would create an
// import cycle once document-edit references this module for its response.
const lineageIdSchema = z.string().min(1).max(255)

/**
 * Authoritative cross-version edit lineage.
 *
 * The lineage records how content that existed in a base version is transformed
 * by an accepted edit batch into an explicit result version. It is produced
 * while operations are applied and canonicalised, never reconstructed by
 * matching reparsed positions, text, counts or identifier sequences.
 *
 * Addressing:
 * - A base node is named by its model id in the base version, which the caller
 *   already holds (the pre-save model).
 * - A result run is named by its result paragraph id plus its index in that
 *   paragraph's run list. The paragraph id is persisted in the result version
 *   (`w14:paraId`), so the address resolves against the reparsed model even
 *   though run model ids are reallocated on every parse.
 * - Text offsets are half-open ranges in UTF-16 code units of the *base run's*
 *   text. `fromRunId: null` marks inserted content that has no base origin.
 *
 * One base run may appear in several result runs (a split); one result run may
 * carry segments from several base runs (a merge or move). The segment list
 * expresses both without a lossy single-id map.
 */
export const documentLineageSegmentSchema = z
  .object({
    /** Base run this content came from; null for inserted content. */
    fromRunId: lineageIdSchema.nullable(),
    /** Start offset in the base run's text (UTF-16 code units). */
    fromOffset: z.number().int().nonnegative(),
    /** End offset in the base run's text (UTF-16 code units, exclusive). */
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
    /** Index in the result paragraph's run list. */
    runIndex: z.number().int().nonnegative(),
    segments: z.array(documentLineageSegmentSchema).min(1),
  })
  .strict()
export type DocumentLineageRun = z.infer<typeof documentLineageRunSchema>

export const documentParagraphLineageSchema = z
  .object({
    /** Base paragraph id; null for a paragraph inserted by this edit. */
    fromParagraphId: lineageIdSchema.nullable(),
    /** Result paragraph id; null for a paragraph deleted by this edit. */
    toParagraphId: lineageIdSchema.nullable(),
    /** Index in the accepted batch that inserted this paragraph. */
    insertedByOperation: z.number().int().nonnegative().optional(),
    /** Opaque intent id echoed from the insert operation, when supplied. */
    insertedByIntent: lineageIdSchema.optional(),
    /**
     * Persisted OOXML change ids (`w:id`) created for a tracked paragraph
     * insertion. The inserted content lives inside `w:ins`, so rejecting these
     * ids restores the pre-insertion content but leaves the paragraph shell.
     * The shell is named by `toParagraphId` and removed in the same decision,
     * which is what makes a saved tracked insertion undoable atomically.
     * Present only when the insertion's content is entirely tracked.
     */
    trackedInsertChangeIds: z.array(lineageIdSchema).min(1).optional(),
    /** Result runs, in paragraph order. Empty when the paragraph was deleted. */
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

/**
 * How a tracked operation is reversed. A tracked text replacement removes the
 * base run from the reparsed model (it lives inside `w:del`/`w:ins`), so it has
 * no result run address. Its reversal is a tracked-change rejection, addressed
 * by the persisted OOXML change ids (`w:id`, stable across versions) the
 * operation created. The client resolves those against the reloaded model's
 * `changes` list and rejects them as one unit; it never invents a run id for
 * content absent from `paragraphs[].runs`.
 */
export const documentLineageReversalSchema = z
  .object({
    /** Index in the accepted batch whose reversal this describes. */
    operation: z.number().int().nonnegative(),
    /** Base run the reversal addresses, when it is run-keyed. */
    fromRunId: lineageIdSchema.nullable(),
    /** Base paragraph the reversal addresses, when it is paragraph-keyed. */
    fromParagraphId: lineageIdSchema.nullable(),
    /** Persisted OOXML change ids to reject together, as one unit. */
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
    /** Indexes in the submitted batch that were actually applied. */
    acceptedOperations: z.array(z.number().int().nonnegative()),
    /**
     * Paragraphs the edit transformed: base paragraphs it touched (including
     * deleted ones) and paragraphs it inserted. The main document story also
     * carries every untouched paragraph, so a run that only shifted position
     * when an earlier paragraph was inserted or split still has a result
     * address; other stories omit untouched paragraphs. The caller needs the
     * result side of the map, never a positional guess.
     */
    paragraphs: z.array(documentParagraphLineageSchema),
    /**
     * Tracked operations whose reversal is a change rejection rather than a run
     * address. Absent when the batch was not tracked or created no changes a
     * rejection can reverse.
     */
    reversals: z.array(documentLineageReversalSchema).optional(),
  })
  .strict()
export type DocumentVersionLineage = z.infer<
  typeof documentVersionLineageSchema
>
