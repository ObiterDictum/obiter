import { z } from 'zod'
import { documentStoryKindSchema } from './document-model'

export const verificationPassageSchema = z
  .object({
    evidenceId: z.string().min(1),
    text: z.string().min(1),
  })
  .strict()

export const verificationEvidenceResponseSchema = z
  .object({
    passages: z.array(verificationPassageSchema),
  })
  .strict()
export type VerificationEvidenceResponse = z.infer<
  typeof verificationEvidenceResponseSchema
>

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

/**
 * Where one piece of evidence can be read. `url` is the stored upstream source
 * and is the only thing the source's name is read from; `canonicalUrl` is the
 * in-app source page built in stage 7; `pinpoint` is the human location inside
 * it and `anchor` the fragment that lands on it. A missing pin cite is null,
 * never an invented one.
 */
export const verificationEvidenceSourceSchema = z
  .object({
    url: z.string().min(1).nullable(),
    canonicalUrl: z.string().min(1).nullable(),
    pinpoint: z.string().min(1).nullable(),
    anchor: z.string().min(1).nullable(),
  })
  .strict()
export type VerificationEvidenceSource = z.infer<
  typeof verificationEvidenceSourceSchema
>

export const verificationEvidenceViewSchema = z
  .object({
    id: z.string().min(1),
    sourceId: z.string().min(1),
    label: z.string().min(1),
    source: verificationEvidenceSourceSchema,
  })
  .strict()
export type VerificationEvidenceView = z.infer<
  typeof verificationEvidenceViewSchema
>

/**
 * A finding a person has dismissed, with who and when. It is a recorded human
 * decision about one finding in one run, so it never rewrites the check's own
 * outcome: the finding keeps its state and the dismissal is shown beside it.
 */
export const verificationFindingDismissalSchema = z
  .object({
    reason: z.string().min(1).nullable(),
    dismissedBy: z.string().min(1),
    /** The dismissing person's member name, for everyone in the matter. Null
     * when the account is no longer an organisation member; the UI then names
     * nobody rather than showing an internal id. */
    dismissedByName: z.string().min(1).nullable(),
    dismissedAt: z.string().datetime({ offset: true }),
  })
  .strict()
export type VerificationFindingDismissal = z.infer<
  typeof verificationFindingDismissalSchema
>

export const verificationFindingDismissRequestSchema = z
  .object({
    reason: z.string().trim().min(1).max(2000).optional(),
  })
  .strict()
export type VerificationFindingDismissRequest = z.infer<
  typeof verificationFindingDismissRequestSchema
>

export const verificationFindingDismissResponseSchema = z
  .object({ dismissal: verificationFindingDismissalSchema })
  .strict()
export type VerificationFindingDismissResponse = z.infer<
  typeof verificationFindingDismissResponseSchema
>

export const verificationFindingViewSchema = z
  .object({
    id: z.string().min(1),
    type: verificationFindingTypeSchema,
    state: verificationFindingStateSchema,
    dismissal: verificationFindingDismissalSchema.nullable(),
    reviewReason: verificationReviewReasonSchema.nullable(),
    severity: verificationSeveritySchema.nullable(),
    confidence: verificationSeveritySchema.nullable(),
    requiresReview: z.boolean(),
    explanation: z.string().min(1),
    excerpt: z.string().min(1),
    location: draftLocationSchema,
    authorityLabel: z.string().min(1),
    /**
     * The stored source's own short title, when the source carries one. It is
     * the case name a citation is read with ("Wood v Capita Insurance Services
     * Ltd [2017] UKSC 24"); null means the store holds no title, and the UI
     * then shows the citation alone rather than inventing a name.
     */
    authorityName: z.string().min(1).nullable(),
    evidence: z.array(verificationEvidenceViewSchema),
  })
  .strict()
export type VerificationFindingView = z.infer<
  typeof verificationFindingViewSchema
>

/**
 * `findingCount` is every persisted finding. The outcome counts are findings
 * still waiting on a person, so a dismissed finding is counted only in
 * `dismissedCount` and never reads as attention outstanding. A check that did
 * not run is counted apart from one that ran and could not conclude: they are
 * different answers, and folding them together was how "needs review" came to
 * cover findings nothing had been compared against.
 */
export const verificationRunSummarySchema = z
  .object({
    findingCount: z.number().int().nonnegative(),
    flaggedCount: z.number().int().nonnegative(),
    reviewRequiredCount: z.number().int().nonnegative(),
    notCheckedCount: z.number().int().nonnegative(),
    dismissedCount: z.number().int().nonnegative(),
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
