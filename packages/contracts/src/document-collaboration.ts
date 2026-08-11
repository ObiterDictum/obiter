import { z } from 'zod'

import { apiErrorResponseSchema } from './api-error'
import {
  DOCUMENT_EDIT_OPERATION_MAX_COUNT,
  DOCUMENT_EDIT_TEXT_MAX_LENGTH,
  documentEditOperationsSchema,
  documentEditResponseSchema,
  editIdSchema,
} from './document-edit'

export const DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT = 50

export const documentCursorSchema = z
  .object({
    paragraphId: editIdSchema,
    runId: editIdSchema,
    offset: z.number().int().nonnegative().max(DOCUMENT_EDIT_TEXT_MAX_LENGTH),
  })
  .strict()
export type DocumentCursor = z.infer<typeof documentCursorSchema>

export const documentPresenceUpdateRequestSchema = z
  .object({ cursor: documentCursorSchema.nullable() })
  .strict()
export type DocumentPresenceUpdateRequest = z.infer<
  typeof documentPresenceUpdateRequestSchema
>

export const documentPresenceSchema = z
  .object({
    userId: z.string().min(1),
    cursor: documentCursorSchema.nullable(),
  })
  .strict()
export type DocumentPresence = z.infer<typeof documentPresenceSchema>

export const documentCollaborationSyncResponseSchema = z
  .object({
    documentId: documentEditResponseSchema.shape.documentId,
    currentVersionId: documentEditResponseSchema.shape.versionId,
    currentVersionNumber: documentEditResponseSchema.shape.versionNumber,
    changed: z.boolean(),
    participants: z
      .array(documentPresenceSchema)
      .max(DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT),
  })
  .strict()
export type DocumentCollaborationSyncResponse = z.infer<
  typeof documentCollaborationSyncResponseSchema
>

export const documentCollaborationMergeRequestSchema = z
  .object({
    baseVersionId: editIdSchema,
    syncId: editIdSchema,
    operations: documentEditOperationsSchema,
    trackChanges: z.boolean().optional(),
  })
  .strict()
export type DocumentCollaborationMergeRequest = z.infer<
  typeof documentCollaborationMergeRequestSchema
>

export const documentCollaborationMergeResponseSchema = z
  .object({
    documentId: documentEditResponseSchema.shape.documentId,
    syncId: editIdSchema,
    baseVersionId: editIdSchema,
    versionId: documentEditResponseSchema.shape.versionId,
    versionNumber: documentEditResponseSchema.shape.versionNumber,
    outcome: z.enum(['merged', 'already_applied']),
  })
  .strict()
export type DocumentCollaborationMergeResponse = z.infer<
  typeof documentCollaborationMergeResponseSchema
>

const documentCollaborationConflictSchema = z
  .object({
    documentId: documentEditResponseSchema.shape.documentId,
    syncId: editIdSchema,
    baseVersionId: editIdSchema,
    currentVersionId: documentEditResponseSchema.shape.versionId,
    currentVersionNumber: documentEditResponseSchema.shape.versionNumber,
    operationIndexes: z
      .array(z.number().int().nonnegative())
      .min(1)
      .max(DOCUMENT_EDIT_OPERATION_MAX_COUNT),
  })
  .strict()
  .superRefine((conflict, context) => {
    if (
      new Set(conflict.operationIndexes).size !==
      conflict.operationIndexes.length
    ) {
      context.addIssue({
        code: 'custom',
        path: ['operationIndexes'],
        message: 'Conflict operation indexes must be unique.',
      })
    }
  })

export const documentCollaborationConflictResponseSchema = z
  .object({
    error: apiErrorResponseSchema.shape.error,
    conflict: documentCollaborationConflictSchema,
  })
  .strict()
export type DocumentCollaborationConflictResponse = z.infer<
  typeof documentCollaborationConflictResponseSchema
>
