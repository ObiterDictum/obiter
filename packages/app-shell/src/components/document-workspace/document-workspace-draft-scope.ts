import type { DocumentModelWire } from '@obiter/contracts'

/**
 * The identity and loaded state one workspace mount drafts against. Every field
 * is document-scoped: the workspace is remounted on a document change, so these
 * never move underneath a live draft.
 */
export type WorkspaceDraftScope = {
  organisationId: string
  userId: string
  documentId: string
  /** Stored version the workspace opened at; undefined until the model loads. */
  baseVersionId: string | undefined
  /** The loaded version number, for provenance against a reload. */
  baseVersionNumber?: number | undefined
  /** Whether the model query failed, so a pending baseline cannot resolve. */
  modelError?: boolean
  /** The loaded model, which a successful save replaces with the saved one. */
  model: DocumentModelWire | undefined
}

export type DraftPersistence = 'ok' | 'unavailable'
