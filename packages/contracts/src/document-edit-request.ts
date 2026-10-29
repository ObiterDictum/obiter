import { z } from 'zod'

import {
  DOCUMENT_EDIT_OPERATION_MAX_COUNT,
  documentEditOperationSchema,
} from './document-edit'
import { editIdSchema } from './document-edit-shared'
import { documentVersionLineageSchema } from './document-lineage'

export const documentEditOperationsSchema = z
  .array(documentEditOperationSchema)
  .min(1)
  .max(DOCUMENT_EDIT_OPERATION_MAX_COUNT)

export const documentEditRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    operations: z
      .array(documentEditOperationSchema)
      .max(DOCUMENT_EDIT_OPERATION_MAX_COUNT),
    trackChanges: z.boolean().optional(),
  })
  .strict()
  .superRefine((request, context) => {
    if (request.operations.length === 0 && request.trackChanges === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['operations'],
        message:
          'An edit request must carry operations or a track-changes state.',
      })
    }
  })
export type DocumentEditRequest = z.infer<typeof documentEditRequestSchema>

export const documentEditResponseSchema = z
  .object({
    documentId: editIdSchema,
    versionId: editIdSchema,
    versionNumber: z.number().int().positive(),
    lineage: documentVersionLineageSchema.optional(),
  })
  .strict()
export type DocumentEditResponse = z.infer<typeof documentEditResponseSchema>
