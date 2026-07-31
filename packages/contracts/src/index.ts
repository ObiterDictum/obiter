import { z } from 'zod'

export type AppPlatform = 'web' | 'desktop'

export const userRoleSchema = z.enum(['owner', 'admin', 'member'])
export type UserRole = z.infer<typeof userRoleSchema>

export const organisationPlanSchema = z.enum(['private_beta'])
export type OrganisationPlan = z.infer<typeof organisationPlanSchema>

export const dataRegionSchema = z.enum(['eu'])
export type DataRegion = z.infer<typeof dataRegionSchema>

export const matterStatusSchema = z.enum(['active', 'archived', 'deleted'])
export type MatterStatus = z.infer<typeof matterStatusSchema>

export const documentStatusSchema = z.enum([
  'queued',
  'processing',
  'ready',
  'failed',
  'needs_review',
])
export type DocumentStatus = z.infer<typeof documentStatusSchema>

export const syncStateSchema = z.enum([
  'local_only',
  'queued',
  'syncing',
  'synced',
  'conflict',
  'failed',
])
export type SyncState = z.infer<typeof syncStateSchema>

export const artifactStatusSchema = z.enum([
  'queued',
  'generating',
  'ready',
  'failed',
])
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>

export const artifactTypeSchema = z.enum([
  'document_text',
  'upload_receipt',
  'processing_log',
  'redaction_report',
  'redaction_output',
  'verification_report',
  'research_memo',
])
export type ArtifactType = z.infer<typeof artifactTypeSchema>

export const spanCategorySchema = z.enum([
  'person_name',
  'email',
  'phone',
  'address',
  'date',
  'government_id',
  'account_number',
  'passport',
  'drivers_license',
  'url',
  'ip_address',
  'national_insurance',
  'case_reference',
  'organisation_name',
  'secret',
])
export type SpanCategory = z.infer<typeof spanCategorySchema>

export const spanSourceSchema = z.enum([
  'rampart_model',
  'rampart_deterministic',
  'uk_supplement',
])
export type SpanSource = z.infer<typeof spanSourceSchema>

export const redactionRunStatusSchema = z.enum([
  'pending',
  'detecting',
  'ready_for_review',
  'reviewing',
  'finalized',
  'failed',
])
export type RedactionRunStatus = z.infer<typeof redactionRunStatusSchema>

export const detectionModeSchema = z.enum([
  'model+supplement',
  'heuristics+supplement',
  'unknown',
])
export type DetectionMode = z.infer<typeof detectionModeSchema>

export const redactionPolicyModeSchema = z.enum([
  'internal_ai_minimisation',
  'external_sharing',
])
export type RedactionPolicyMode = z.infer<typeof redactionPolicyModeSchema>

export const spanConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type SpanConfidence = z.infer<typeof spanConfidenceSchema>

export const spanSuggestionSchema = z.enum(['redact', 'keep'])
export type SpanSuggestion = z.infer<typeof spanSuggestionSchema>

export const spanDecisionSchema = z.enum([
  'accept',
  'reject',
  'override_redact',
  'override_keep',
  'pseudonymise',
])
export type SpanDecision = z.infer<typeof spanDecisionSchema>

export const outputModeSchema = z.enum(['redacted', 'pseudonymised'])
export type OutputMode = z.infer<typeof outputModeSchema>

const finiteNumberSchema = z.number().finite()
const nonNegativeFiniteNumberSchema = finiteNumberSchema.nonnegative()
const positiveFiniteNumberSchema = finiteNumberSchema.positive()

export const documentTextLayoutSegmentSchema = z
  .object({
    start: z.number().int().nonnegative(),
    end: z.number().int().positive(),
    pageIndex: z.number().int().nonnegative(),
    x: finiteNumberSchema,
    y: finiteNumberSchema,
    width: nonNegativeFiniteNumberSchema,
    height: positiveFiniteNumberSchema,
    ascent: nonNegativeFiniteNumberSchema.optional(),
    descent: nonNegativeFiniteNumberSchema.optional(),
    /** Origin-to-origin displacement in the run's writing direction. */
    advances: z.array(nonNegativeFiniteNumberSchema).optional(),
    /** Drawn-advance overrides where kerning makes placement differ. */
    glyphWidthOverrides: z
      .record(
        z.string().regex(/^(?:0|[1-9]\d*)$/u),
        nonNegativeFiniteNumberSchema,
      )
      .optional(),
    /** Unit writing direction. Omitted for ordinary left-to-right text. */
    baselineX: finiteNumberSchema.optional(),
    baselineY: finiteNumberSchema.optional(),
  })
  .superRefine((segment, context) => {
    const length = segment.end - segment.start
    if (length <= 0) {
      context.addIssue({
        code: 'custom',
        path: ['end'],
        message: 'Layout segment end must be greater than start.',
      })
    }
    if (segment.advances && segment.advances.length !== length) {
      context.addIssue({
        code: 'custom',
        path: ['advances'],
        message: 'advances must contain one entry per layout character.',
      })
    }
    for (const index of Object.keys(segment.glyphWidthOverrides ?? {})) {
      if (Number(index) >= length) {
        context.addIssue({
          code: 'custom',
          path: ['glyphWidthOverrides', index],
          message: 'Glyph width override index is out of range.',
        })
      }
    }
    if (
      (segment.baselineX === undefined) !==
      (segment.baselineY === undefined)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineX'],
        message: 'Layout baseline direction must include both components.',
      })
    }
    if (
      segment.baselineX !== undefined &&
      segment.baselineY !== undefined &&
      Math.abs(Math.hypot(segment.baselineX, segment.baselineY) - 1) > 0.01
    ) {
      context.addIssue({
        code: 'custom',
        path: ['baselineX'],
        message: 'Layout baseline direction must be a unit vector.',
      })
    }
  })

export type DocumentTextLayoutSegment = z.infer<
  typeof documentTextLayoutSegmentSchema
>

const documentTextLayoutPageSchema = z.object({
  width: positiveFiniteNumberSchema,
  height: positiveFiniteNumberSchema,
})

/**
 * Version 1 remains readable and deliberately falls back to interpolation.
 * Version 2 separates origin placement (`advances`) from sparse drawn-extent
 * overrides so kerning cannot shorten a redaction cover.
 */
export const documentTextLayoutSchema = z
  .object({
    version: z.union([z.literal(1), z.literal(2)]),
    pages: z.array(documentTextLayoutPageSchema).min(1),
    segments: z.array(documentTextLayoutSegmentSchema),
  })
  .superRefine((layout, context) => {
    layout.segments.forEach((segment, index) => {
      if (segment.pageIndex >= layout.pages.length) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index, 'pageIndex'],
          message: 'Layout segment page index is out of range.',
        })
      }
      if (
        layout.version === 2 &&
        (segment.advances === undefined ||
          segment.glyphWidthOverrides === undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index, 'glyphWidthOverrides'],
          message:
            'Version 2 geometry requires placement advances and glyph width overrides.',
        })
      }
      if (
        layout.version === 1 &&
        (segment.glyphWidthOverrides !== undefined ||
          segment.baselineX !== undefined ||
          segment.baselineY !== undefined)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['segments', index],
          message: 'Version 1 segments cannot contain version 2 geometry.',
        })
      }
    })
  })

export type DocumentTextLayout = z.infer<typeof documentTextLayoutSchema>

export const redactionFinalizeInputSchema = z.object({
  outputMode: outputModeSchema,
  degradedDetectionAcknowledged: z.boolean().optional(),
  unknownDetectionAcknowledged: z.boolean().optional(),
})
export type RedactionFinalizeInput = z.infer<
  typeof redactionFinalizeInputSchema
>

export type Tone = 'ink' | 'sage' | 'amber' | 'rust'

// role is nullable: a newly self-registered user has no organisation and no
// role until they explicitly create one. It is set to 'owner' on org creation.
export const currentUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: userRoleSchema.nullable(),
})
export type CurrentUser = z.infer<typeof currentUserSchema>

export const currentOrganisationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  plan: organisationPlanSchema,
})
export type CurrentOrganisation = z.infer<typeof currentOrganisationSchema>

// organisation is nullable: self-registration no longer provisions an org.
// GET /api/me returns { user, organisation: null } for an org-less user, and
// the client renders the create-organisation surface instead of matters.
export const meResponseSchema = z.object({
  user: currentUserSchema,
  organisation: currentOrganisationSchema.nullable(),
})
export type MeResponse = z.infer<typeof meResponseSchema>

export const ORGANISATION_NAME_MAX_LENGTH = 120

export const createOrganisationInputSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Organisation name is required.')
    .max(ORGANISATION_NAME_MAX_LENGTH, 'Organisation name is too long.'),
})
export type CreateOrganisationInput = z.infer<
  typeof createOrganisationInputSchema
>

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
  'document_not_found',
  'document_version_not_found',
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

export type AuthViewState =
  | { status: 'authenticated'; me: MeResponse }
  | { status: 'unauthenticated' }
  | { status: 'organisation_missing'; user: CurrentUser }
  | { status: 'organisation_inactive'; user: CurrentUser }

export function createCanonicalCasePath(input: {
  id: string
  title: string
  neutralCitation: string | null
}) {
  const documentIdSlug = slugifyCaseText(input.id)
  const citationSlug = input.neutralCitation
    ? slugifyCaseCitation(input.neutralCitation)
    : ''
  const titleSlug = slugifyCaseText(input.title)
  const slug = input.id.startsWith('d-')
    ? [documentIdSlug, titleSlug, citationSlug].filter(Boolean).join('-')
    : citationSlug
      ? [titleSlug, citationSlug].filter(Boolean).join('-')
      : documentIdSlug

  return `/case/${slug}`
}

export function resolveCaseDocumentIdFromSlug(caseSlug: string) {
  const normalizedSlug = slugifyCaseText(caseSlug)
  const stableDocumentId = normalizedSlug
    .match(
      /^d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-|$)/,
    )?.[0]
    ?.replace(/-$/, '')
  if (stableDocumentId) return stableDocumentId

  const parts = normalizedSlug.split('-').filter(Boolean)
  const citationStart = findCitationSlugStart(parts)

  if (citationStart === -1) return normalizedSlug

  const citationParts = parts.slice(citationStart)
  const year = citationParts[0]
  const numberIndex = citationParts.findIndex(
    (part, index) => index > 1 && /^\d+$/.test(part),
  )
  if (!year || numberIndex === -1) return normalizedSlug

  const number = citationParts[numberIndex]
  const courtParts = [
    ...citationParts.slice(1, numberIndex),
    ...citationParts.slice(numberIndex + 1),
  ]

  return `${courtParts.join('-')}-${year}-${number}`
}

function findCitationSlugStart(parts: string[]) {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    if (
      /^\d{4}$/.test(parts[index] ?? '') &&
      parts.slice(index + 2).some((part) => /^\d+$/.test(part))
    ) {
      return index
    }
  }

  return -1
}

function slugifyCaseCitation(value: string) {
  return slugifyCaseText(value.replace(/[[\]()]/g, ' '))
}

function slugifyCaseText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
