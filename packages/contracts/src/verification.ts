import { z } from 'zod'
import { documentStoryKindSchema } from './document-model'

export const verificationRunStatusSchema = z.enum([
  'queued',
  'running',
  'completed',
  'failed',
])
export type VerificationRunStatus = z.infer<typeof verificationRunStatusSchema>

export const verificationFailureCodeSchema = z.enum([
  'model_unavailable',
  'version_not_ready',
  'execution_failed',
  'interrupted',
])
export type VerificationFailureCode = z.infer<
  typeof verificationFailureCodeSchema
>

export const verificationFindingTypeSchema = z.enum([
  'authority_existence',
  'citation_resolution',
  'quote_fidelity',
])
export type VerificationFindingType = z.infer<
  typeof verificationFindingTypeSchema
>

export const verificationFindingStateSchema = z.enum([
  'clear',
  'flagged',
  'not_checked',
  'review_required',
])
export type VerificationFindingState = z.infer<
  typeof verificationFindingStateSchema
>

export const verificationReviewReasonSchema = z.enum([
  'citation_ambiguous',
  'citation_unresolved',
  'authority_not_held',
  'evidence_unavailable',
  'check_inconclusive',
])
export type VerificationReviewReason = z.infer<
  typeof verificationReviewReasonSchema
>

export const verificationSeveritySchema = z.enum(['high', 'medium', 'low'])
export type VerificationSeverity = z.infer<typeof verificationSeveritySchema>

const draftLocationSchema = z
  .object({
    paragraphId: z.string().min(1),
    // Paragraph ids are only unique inside their story, so the story kind and
    // part name are part of a location's identity. They are optional here so
    // V1-V4 findings, whose fixtures predate story coverage, still parse; V5
    // extraction always sets both.
    storyKind: documentStoryKindSchema.optional(),
    storyPartName: z.string().min(1).optional(),
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
  })
  .strict()
  .refine((location) => location.end > location.start, {
    message: 'A draft location must be a non-empty half-open span.',
    path: ['end'],
  })

export const verificationEvidenceViewSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    label: z.string().min(1),
  })
  .strict()
export type VerificationEvidenceView = z.infer<
  typeof verificationEvidenceViewSchema
>

export const verificationFindingViewSchema = z
  .object({
    id: z.string().min(1),
    type: verificationFindingTypeSchema,
    state: verificationFindingStateSchema,
    reviewReason: verificationReviewReasonSchema.nullable(),
    severity: verificationSeveritySchema.nullable(),
    confidence: verificationSeveritySchema.nullable(),
    requiresReview: z.boolean(),
    explanation: z.string().min(1),
    excerpt: z.string().min(1),
    location: draftLocationSchema,
    authorityLabel: z.string().min(1),
    evidence: z.array(verificationEvidenceViewSchema),
  })
  .strict()
export type VerificationFindingView = z.infer<
  typeof verificationFindingViewSchema
>

export const verificationRunSummarySchema = z
  .object({
    findingCount: z.number().int().nonnegative(),
    flaggedCount: z.number().int().nonnegative(),
    reviewRequiredCount: z.number().int().nonnegative(),
  })
  .strict()
export type VerificationRunSummary = z.infer<
  typeof verificationRunSummarySchema
>

export const verificationRunSchema = z
  .object({
    id: z.string().min(1),
    organisationId: z.string().min(1),
    matterId: z.string().min(1),
    documentId: z.string().min(1),
    documentVersionId: z.string().min(1),
    status: verificationRunStatusSchema,
    failureCode: verificationFailureCodeSchema.nullable(),
    createdBy: z.string().min(1),
    createdAt: z.string().datetime({ offset: true }),
    startedAt: z.string().datetime({ offset: true }).nullable(),
    completedAt: z.string().datetime({ offset: true }).nullable(),
    summary: verificationRunSummarySchema,
    documentCurrentVersionId: z.string().min(1).nullable(),
    stale: z.boolean(),
  })
  .strict()
export type VerificationRun = z.infer<typeof verificationRunSchema>

export const verificationRunCreateRequestSchema = z
  .object({
    versionId: z.string().min(1),
  })
  .strict()
export type VerificationRunCreateRequest = z.infer<
  typeof verificationRunCreateRequestSchema
>

export const verificationRunResponseSchema = z
  .object({
    run: verificationRunSchema,
  })
  .strict()
export type VerificationRunResponse = z.infer<
  typeof verificationRunResponseSchema
>

export const verificationListDefaultLimit = 25
export const verificationListMaxLimit = 100
export const verificationFindingsDefaultLimit = 50
export const verificationFindingsMaxLimit = 200

/**
 * A run and finding list is keyset-paginated on `(created_at desc, id desc)`.
 * The cursor is an opaque base64url token the API encodes and validates; the
 * client only echoes it back, so the shape may change without a contract bump.
 */
export const verificationCursorSchema = z.string().min(1)
export type VerificationCursor = z.infer<typeof verificationCursorSchema>

export const verificationRunListQuerySchema = z
  .object({
    limit: z.number().int().min(1).max(verificationListMaxLimit).optional(),
    cursor: verificationCursorSchema.optional(),
  })
  .strict()
export type VerificationRunListQuery = z.infer<
  typeof verificationRunListQuerySchema
>

export const verificationRunListResponseSchema = z
  .object({
    runs: z.array(verificationRunSchema),
    nextCursor: verificationCursorSchema.nullable(),
  })
  .strict()
export type VerificationRunListResponse = z.infer<
  typeof verificationRunListResponseSchema
>

export const verificationFindingsResponseSchema = z
  .object({
    run: verificationRunSchema,
    findings: z.array(verificationFindingViewSchema),
    nextCursor: verificationCursorSchema.nullable(),
  })
  .strict()
export type VerificationFindingsResponse = z.infer<
  typeof verificationFindingsResponseSchema
>
