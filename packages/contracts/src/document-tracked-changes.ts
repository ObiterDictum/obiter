import { z } from 'zod'

import { documentChangeWireSchema } from './document-model'

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
    baseVersionId: z.string().min(1),
    action: z.enum(['accept', 'reject']),
    changeIds: z.array(z.string().min(1)).min(1).max(100),
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
  })
export type DocumentTrackedChangeDecisionRequest = z.infer<
  typeof documentTrackedChangeDecisionRequestSchema
>
