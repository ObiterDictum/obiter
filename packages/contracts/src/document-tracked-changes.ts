import { z } from 'zod'

import { editIdSchema } from './document-edit'
import { documentChangeWireSchema } from './document-model'

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
    removeParagraphIds: z
      .array(editIdSchema)
      .min(1)
      .max(TRACKED_DECISION_MAX_IDS)
      .optional(),
    trackRevisions: z.boolean().optional(),
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
