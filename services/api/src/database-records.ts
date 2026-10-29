import type { UserRole } from '@obiter/contracts'

export interface SessionUserRecord {
  id: string
  email: string
  name: string
  organisationId?: string | null
  role?: UserRole | null
}

export type MatterStatus = 'active' | 'archived' | 'deleted'
export type UpdatableMatterStatus = Exclude<MatterStatus, 'deleted'>
export type DocumentStatus =
  'queued' | 'processing' | 'ready' | 'failed' | 'needs_review'
export type SyncState =
  'local_only' | 'queued' | 'syncing' | 'synced' | 'conflict' | 'failed'

export interface MatterRecord {
  id: string
  organisationId: string
  name: string
  description: string | null
  primaryJurisdiction: string
  secondaryJurisdictions: string[]
  legalDomains: string[]
  clientReference: string
  status: MatterStatus
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
}

export interface DocumentVersionRecord {
  id: string
  organisationId: string
  matterId: string
  matterDocumentId: string
  filename: string
  fileType: string
  sizeBytes: string
  objectKey: string
  textObjectKey: string | null
  documentStatus: DocumentStatus
  failureReason: string | null
  versionNumber: number
  contentSha256: string
  syncState: SyncState
  createdBy: string
  createdAt: string
  updatedAt: string
  lineage: unknown
  redaction: DocumentVersionRedaction | null
}

export interface DocumentVersionRedaction {
  runId: string
  producedBy: string | null
  canOpen: boolean
}

export interface MatterDocumentRecord {
  id: string
  organisationId: string
  matterId: string
  currentVersionId: string | null
  logicalKey: string
  createdBy: string
  createdAt: string
  updatedAt: string
  deletedAt: string | null
  deletedBy: string | null
  currentVersion?: DocumentVersionRecord | null
}

export interface CreateMatterInput {
  organisationId: string
  userId: string
  name: string
  description?: string | null
  primaryJurisdiction: string
  secondaryJurisdictions?: string[]
  legalDomains?: string[]
  clientReference?: string
}

export interface UpdateMatterInput {
  name?: string
  description?: string | null
  primaryJurisdiction?: string
  secondaryJurisdictions?: string[]
  legalDomains?: string[]
  clientReference?: string
  status?: UpdatableMatterStatus
}

export interface RestoreMatterInput {
  organisationId: string
  userId: string
  id: string
  requestId: string
}

export interface CreateDocumentInput {
  organisationId: string
  matterId: string
  userId: string
  filename: string
  fileType: string
  sizeBytes: number
  contentSha256: string
  syncState?: SyncState
}

export interface InsertDocumentVersionInput {
  id: string
  organisationId: string
  matterId: string
  documentId: string
  filename: string
  fileType: string
  sizeBytes: number
  objectKey: string
  textObjectKey: string | null
  documentStatus: DocumentStatus
  failureReason: string | null
  versionNumber: number
  contentSha256: string
  syncState: SyncState
  createdBy: string
  lineage?: unknown
}
