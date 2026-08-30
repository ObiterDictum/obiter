import { z } from 'zod'

export const apiErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'validation_failed',
  'organisation_not_found',
  // An authenticated user with no organisation tried an org-scoped endpoint.
  // Returned as 403 so the client can distinguish "sign in" from "create org".
  'no_organisation',
  'closed_beta_required',
  'matter_not_found',
  'matter_share_not_found',
  'document_not_found',
  'document_version_not_found',
  'comment_anchor_unresolved',
  'artifact_not_found',
  'upload_failed',
  'storage_unavailable',
  'job_unavailable',
  'conflict_detected',
  'redaction_run_not_found',
  'span_not_found',
  'redaction_run_not_reviewable',
  'redaction_already_finalized',
  'redaction_detection_failed',
  'redaction_model_unavailable',
  'redaction_span_integrity_error',
  'payload_too_large',
  'ooxml_limits_exceeded',
  'hydration_budget_exceeded',
])
export type ApiErrorCode = z.infer<typeof apiErrorCodeSchema>

export const apiErrorResponseSchema = z.object({
  error: z.object({
    code: apiErrorCodeSchema,
    message: z.string().min(1),
    requestId: z.string().min(1),
  }),
})
export type ApiErrorResponse = z.infer<typeof apiErrorResponseSchema>
