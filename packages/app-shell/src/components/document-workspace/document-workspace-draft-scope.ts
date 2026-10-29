import type { DocumentModelWire } from '@obiter/contracts'

export type WorkspaceDraftScope = {
  organisationId: string
  userId: string
  documentId: string
  baseVersionId: string | undefined
  baseVersionNumber?: number | undefined
  modelError?: boolean
  model: DocumentModelWire | undefined
}

export type DraftPersistence = 'ok' | 'unavailable'
