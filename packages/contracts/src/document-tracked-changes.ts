import { z } from 'zod'

import { editIdSchema } from './document-edit'
import { documentChangeWireSchema } from './document-model'

/**
 * The bound on how many changes one decision request may carry. Bulk
 * accept/reject sends every listed change in a single atomic request, so the
 * cap is the only thing bounding the payload; the value is shared by the
 * schema, the decision engine, and the client's bulk affordances so a bulk
 * action is disabled honestly rather than rejected after the fact.
 */
export const TRACKED_DECISION_MAX_IDS = 500

export const documentTrackedChangeListResponseSchema = z
  .object({
    documentId: z.string().min(1),
    versionId: z.string().min(1),
    versionNumber: z.number().int().positive(),
    changes: z.array(documentChangeWireSchema),
  })
  .strict()
export type DocumentTrackedChangeListResponse = z.infer<
  typeof documentTrackedChangeListResponseSchema
>

export const documentTrackedChangeDecisionRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    action: z.enum(['accept', 'reject']),
    changeIds: z.array(z.string().min(1)).min(1).max(TRACKED_DECISION_MAX_IDS),
    /**
     * Persisted paragraph ids (`para-w14-<value>`) whose empty tracked-change
     * shell this decision removes. A tracked paragraph insertion wraps its
     * content in `w:ins`, so rejecting that change restores the pre-insertion
     * content but leaves an empty paragraph behind. Removing the shell in the
     * same authorized, version-checked decision is what makes the reversal
     * atomic; a separate delete would be refused while the change is pending.
     * Only valid with `action: 'reject'`, and the server verifies each id is an
     * empty shell whose content is entirely one of the rejected insertions.
     */
    removeParagraphIds: z
      .array(editIdSchema)
      .min(1)
      .max(TRACKED_DECISION_MAX_IDS)
      .optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (new Set(request.changeIds).size !== request.changeIds.length) {
      context.addIssue({
        code: 'custom',
        path: ['changeIds'],
        message: 'Tracked change identifiers must be unique.',
      })
    }
    if (request.removeParagraphIds && request.action !== 'reject') {
      context.addIssue({
        code: 'custom',
        path: ['removeParagraphIds'],
        message: 'A paragraph shell can only be removed by a rejection.',
      })
    }
    if (
      request.removeParagraphIds &&
      new Set(request.removeParagraphIds).size !==
        request.removeParagraphIds.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['removeParagraphIds'],
        message: 'Removed paragraph identifiers must be unique.',
      })
    }
  })
export type DocumentTrackedChangeDecisionRequest = z.infer<
  typeof documentTrackedChangeDecisionRequestSchema
>
