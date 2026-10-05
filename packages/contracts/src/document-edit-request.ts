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

export const documentEditRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    operations: documentEditOperationsSchema,
    trackChanges: z.boolean().optional().default(false),
  })
  .strict()
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
