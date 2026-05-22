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

export const matterSchema = z.object({
  id: z.string().min(1),
  organisationId: z.string().min(1),
  name: z.string().min(1),
  description: z.string().nullable(),
  primaryJurisdiction: z.string().min(1),
  secondaryJurisdictions: z.array(z.string()),
  legalDomains: z.array(z.string()),
  clientReference: z.string(),
  status: matterStatusSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  deletedAt: z.string().nullable(),
})
export type Matter = z.infer<typeof matterSchema>

export const createMatterRequestSchema = z.object({
  name: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable().optional(),
  primaryJurisdiction: z.string().trim().min(1),
  secondaryJurisdictions: z.array(z.string().trim().min(1)).optional(),
  legalDomains: z.array(z.string().trim().min(1)).optional(),
  clientReference: z.string().trim().optional(),
})
export type CreateMatterRequest = z.infer<typeof createMatterRequestSchema>

export const matterResponseSchema = z.object({
  matter: matterSchema,
})
export type MatterResponse = z.infer<typeof matterResponseSchema>

export const listMattersResponseSchema = z.object({
  matters: z.array(matterSchema),
})
export type ListMattersResponse = z.infer<typeof listMattersResponseSchema>

export const documentVersionSchema = z.object({
  id: z.string().min(1),
  organisationId: z.string().min(1),
  matterId: z.string().min(1),
  matterDocumentId: z.string().min(1),
  filename: z.string().min(1),
  fileType: z.string().min(1),
  sizeBytes: z.number().int().nonnegative(),
  objectKey: z.string().min(1),
  textObjectKey: z.string().nullable(),
  documentStatus: documentStatusSchema,
  failureReason: z.string().nullable(),
  versionNumber: z.number().int().positive(),
  contentSha256: z.string().min(1),
  syncState: syncStateSchema,
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
})
export type DocumentVersion = z.infer<typeof documentVersionSchema>

export const matterDocumentSchema = z.object({
  id: z.string().min(1),
  organisationId: z.string().min(1),
  matterId: z.string().min(1),
  currentVersionId: z.string().nullable(),
  logicalKey: z.string().min(1),
  createdBy: z.string().min(1),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  deletedAt: z.string().nullable(),
  currentVersion: documentVersionSchema.nullable().optional(),
})
export type MatterDocument = z.infer<typeof matterDocumentSchema>

export const createDocumentMetadataRequestSchema = z.object({
  filename: z.string().trim().min(1),
  fileType: z.string().trim().min(1),
  contentSha256: z.string().trim().min(1),
  sizeBytes: z.number().int().nonnegative(),
})
export type CreateDocumentMetadataRequest = z.infer<
  typeof createDocumentMetadataRequestSchema
>

export const createDocumentMetadataResponseSchema = z.object({
  document: matterDocumentSchema,
  version: documentVersionSchema,
})
export type CreateDocumentMetadataResponse = z.infer<
  typeof createDocumentMetadataResponseSchema
>

export const listMatterDocumentsResponseSchema = z.object({
  documents: z.array(matterDocumentSchema),
})
export type ListMatterDocumentsResponse = z.infer<
  typeof listMatterDocumentsResponseSchema
>

export const documentDetailResponseSchema = z.object({
  document: matterDocumentSchema,
  versions: z.array(documentVersionSchema),
})
export type DocumentDetailResponse = z.infer<typeof documentDetailResponseSchema>

export const deleteDocumentResponseSchema = z.object({
  document: matterDocumentSchema,
})
export type DeleteDocumentResponse = z.infer<typeof deleteDocumentResponseSchema>

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
  matterId: string
  currentVersionId: string | null
  logicalKey: string
  filename: string
  fileType: string
  sizeBytes: number
  contentSha256: string
  versionNumber: number | null
  updatedAt: string
  status: DocumentStatus
  syncState: SyncState
  deletedAt: string | null
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
