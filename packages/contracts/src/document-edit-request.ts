import { z } from 'zod'

import {
  DOCUMENT_EDIT_OPERATION_MAX_COUNT,
  documentEditOperationSchema,
} from './document-edit'
import { editIdSchema } from './document-edit-shared'
import { documentVersionLineageSchema } from './document-lineage'

/**
 * The document-edit request/response envelope: the operation union composed
 * into a versioned batch. It sits apart from `document-edit.ts`, which has
 * reached its source ceiling carrying the operation declarations alone.
 */
export const documentEditOperationsSchema = z
  .array(documentEditOperationSchema)
  .min(1)
  .max(DOCUMENT_EDIT_OPERATION_MAX_COUNT)

/**
 * `trackChanges` both asks for the batch to be recorded as tracked changes
 * and is the persisted `w:trackRevisions` state of the version it creates.
 * An omitted field leaves the stored toggle — and the tracking behaviour —
 * as the base version carries it, so an older client can never clear the
 * setting by accident. An empty `operations` with the field present is a
 * settings-only save: a version whose only delta is the toggle.
 */
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
    /**
     * E50: how the accepted batch transformed the base version. Optional for
     * compatibility with servers that predate cross-version lineage.
     */
    lineage: documentVersionLineageSchema.optional(),
  })
  .strict()
export type DocumentEditResponse = z.infer<typeof documentEditResponseSchema>
