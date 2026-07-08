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

export const artifactStatusSchema = z.enum(['queued', 'generating', 'ready', 'failed'])
export type ArtifactStatus = z.infer<typeof artifactStatusSchema>

export const artifactTypeSchema = z.enum([
  'document_text',
  'upload_receipt',
  'processing_log',
  'redaction_report',
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

export const spanSourceSchema = z.enum(['rampart_model', 'rampart_deterministic', 'uk_supplement'])
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

export const redactionPolicyModeSchema = z.enum(['internal_ai_minimisation', 'external_sharing'])
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

export type Tone = 'ink' | 'sage' | 'amber' | 'rust'

export const currentUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  name: z.string().min(1),
  role: userRoleSchema,
})
export type CurrentUser = z.infer<typeof currentUserSchema>

export const currentOrganisationSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  plan: organisationPlanSchema,
})
export type CurrentOrganisation = z.infer<typeof currentOrganisationSchema>

export const meResponseSchema = z.object({
  user: currentUserSchema,
  organisation: currentOrganisationSchema,
})
export type MeResponse = z.infer<typeof meResponseSchema>

export const apiErrorCodeSchema = z.enum([
  'unauthenticated',
  'forbidden',
  'validation_failed',
  'organisation_not_found',
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

export interface OrganisationSummary {
  id: string
  name: string
  plan: OrganisationPlan
  seatCount: number
}

export interface UserSummary {
  id: string
  name: string
  email: string
  role: UserRole
}

export interface MatterDocumentSummary {
  id: string
  filename: string
  kind: string
  updatedAt: string
  status: DocumentStatus
}

export interface ArtifactSummary {
  id: string
  name: string
  kind: string
  updatedAt: string
  status: ArtifactStatus
}

export interface ActivitySummary {
  id: string
  title: string
  detail: string
  occurredAt: string
}

export interface MatterRecord {
  id: string
  name: string
  clientReference: string
  primaryJurisdiction: string
  practiceArea: string
  status: MatterStatus
  summary: string
  documents: MatterDocumentSummary[]
  reports: ArtifactSummary[]
  activity: ActivitySummary[]
}

export interface ShellMetric {
  id: string
  label: string
  value: string
  detail: string
  tone: Tone
}

export interface PhaseZeroMilestone {
  id: string
  label: string
  detail: string
  status: 'done' | 'active' | 'next'
}

export interface ShellAlert {
  id: string
  title: string
  detail: string
}

export interface ShellSnapshot {
  platform: AppPlatform
  organisation: OrganisationSummary
  currentUser: UserSummary
  matters: MatterRecord[]
  featuredMatterId: string
  metrics: ShellMetric[]
  milestones: PhaseZeroMilestone[]
  alerts: ShellAlert[]
}

export function createCanonicalCasePath(input: {
  id: string
  title: string
  neutralCitation: string | null
}) {
  const documentIdSlug = slugifyCaseText(input.id)
  const citationSlug = input.neutralCitation ? slugifyCaseCitation(input.neutralCitation) : ''
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
  const stableDocumentId = normalizedSlug.match(
    /^d-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?:-|$)/,
  )?.[0]?.replace(/-$/, '')
  if (stableDocumentId) return stableDocumentId

  const parts = normalizedSlug.split('-').filter(Boolean)
  const citationStart = findCitationSlugStart(parts)

  if (citationStart === -1) return normalizedSlug

  const citationParts = parts.slice(citationStart)
  const year = citationParts[0]
  const numberIndex = citationParts.findIndex((part, index) => index > 1 && /^\d+$/.test(part))
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
    if (/^\d{4}$/.test(parts[index] ?? '') && parts.slice(index + 2).some((part) => /^\d+$/.test(part))) {
      return index
    }
  }

  return -1
}

function slugifyCaseCitation(value: string) {
  return slugifyCaseText(value.replace(/[\[\]()]/g, ' '))
}

function slugifyCaseText(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}
