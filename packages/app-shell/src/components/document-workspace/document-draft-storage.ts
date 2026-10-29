import {
  resolveDocumentDraftWriter,
  type DraftScope,
  type DraftStorage,
} from '../../document-draft-store'
import type { WorkspaceDraftScope } from './document-workspace-draft-scope'

export function draftStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage
  } catch {
    return null
  }
}

export function sessionDraftStorage(): DraftStorage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function resolveDraftScope(
  scope: WorkspaceDraftScope,
  session: DraftStorage | null,
  storage: DraftStorage | null,
  instanceId: string,
): DraftScope {
  return {
    ...scope,
    tabId: resolveDocumentDraftWriter(session, storage, instanceId),
  }
}
