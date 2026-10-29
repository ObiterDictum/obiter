import type { DraftState } from './document-save-plan'
import {
  parseDraftSnapshot,
  type DocumentDraftSnapshot,
  type HeldChange,
} from './document-draft-schema'
import {
  CLAIM_PREFIX,
  DOCUMENT_DRAFT_KEY_PREFIX,
  DOCUMENT_DRAFT_SCHEMA_VERSION,
  REGISTRY_PREFIX,
  allKeys,
  clearDocumentDraftsMatching,
  documentDraftKey,
  documentStaleDraftKey,
  keyIncludesUser,
  newTabId,
  removeKey,
  writerIsLive,
  writeRegistry,
  type DraftScope,
  type DraftStorage,
  type RecoverableDraft,
} from './document-draft-identity'

export {
  DOCUMENT_DRAFT_SCHEMA_VERSION,
  documentDraftKey,
  documentDraftTabId,
  releaseDocumentDraftWriterClaim,
  resolveDocumentDraftWriter,
  touchDocumentDraftWriterClaim,
  type DraftScope,
  type DraftStorage,
  type RecoverableDraft,
} from './document-draft-identity'

const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export type { HeldChange } from './document-draft-schema'

let writesSuspended = false
let rememberedUserId: string | null = null

export function suspendDocumentDraftWrites() {
  writesSuspended = true
}

export function resumeDocumentDraftWrites() {
  writesSuspended = false
}

export function rememberDocumentDraftUser(userId: string | null) {
  rememberedUserId = userId
}

export type DraftRestore =
  | { status: 'empty' }
  | {
      status: 'restored'
      state: DraftState
      held: HeldChange[]
      trackChangesFlip?: boolean
      draftId: string
    }
  | { status: 'stale'; baseVersionId: string }
  | { status: 'choice'; drafts: RecoverableDraft[] }
  | { status: 'unavailable' }

export function listDocumentDrafts(
  storage: DraftStorage,
  scope: Omit<DraftScope, 'tabId'>,
): RecoverableDraft[] {
  const listed: RecoverableDraft[] = []
  for (const record of scanPayloads(storage, scope)) {
    if (expired(record.snapshot.updatedAt)) {
      removeKey(storage, record.key)
      continue
    }
    listed.push(toRecoverable(record))
  }
  writeRegistry(
    storage,
    scope.organisationId,
    scope.userId,
    scope.documentId,
    listed,
  )
  return listed
}

export function listRecoverableDocumentDrafts(
  storage: DraftStorage,
  scope: DraftScope,
  excludeDraftId?: string,
): RecoverableDraft[] {
  return listDocumentDrafts(storage, scope).filter((item) => {
    if (item.draftId === excludeDraftId) return false
    if (item.writerId === scope.tabId && item.status === 'active') return false
    if (item.status === 'parked') return true
    return !writerIsLive(storage, item.writerId)
  })
}

export function readDocumentDraft(
  storage: DraftStorage,
  scope: DraftScope,
  currentVersionId: string,
): DraftRestore {
  try {
    storage.getItem(documentDraftKey(scope))
    const records = scanPayloads(storage, scope).filter((record) => {
      if (expired(record.snapshot.updatedAt)) {
        removeKey(storage, record.key)
        return false
      }
      return true
    })
    writeRegistry(
      storage,
      scope.organisationId,
      scope.userId,
      scope.documentId,
      records.map(toRecoverable),
    )

    const own = records.filter((record) => record.writerId === scope.tabId)
    const ownActive = own.find((record) => record.status === 'active')
    if (ownActive) {
      if (ownActive.snapshot.baseVersionId !== currentVersionId) {
        parkRecord(storage, ownActive)
        return {
          status: 'stale',
          baseVersionId: ownActive.snapshot.baseVersionId,
        }
      }
      return {
        status: 'restored',
        state: ownActive.snapshot.state,
        held: ownActive.snapshot.held,
        trackChangesFlip: ownActive.snapshot.trackChangesFlip,
        draftId: ownActive.draftId,
      }
    }

    const ownParked = own.find((record) => record.status === 'parked')
    const abandoned = records.filter(
      (record) =>
        record.status === 'active' &&
        record.snapshot.baseVersionId === currentVersionId &&
        record.writerId !== scope.tabId &&
        !writerIsLive(storage, record.writerId),
    )
    if (abandoned.length === 1 && abandoned[0]) {
      const adopted = adoptRecord(storage, abandoned[0], scope.tabId)
      return {
        status: 'restored',
        state: adopted.snapshot.state,
        held: adopted.snapshot.held,
        trackChangesFlip: adopted.snapshot.trackChangesFlip,
        draftId: adopted.draftId,
      }
    }
    if (abandoned.length > 1) {
      return { status: 'choice', drafts: abandoned.map(toRecoverable) }
    }
    if (ownParked) {
      return {
        status: 'stale',
        baseVersionId: ownParked.snapshot.baseVersionId,
      }
    }
    const parked = records.filter((record) => record.status === 'parked')
    if (parked[0]) {
      return {
        status: 'stale',
        baseVersionId: parked[0].snapshot.baseVersionId,
      }
    }
    return { status: 'empty' }
  } catch {
    return { status: 'unavailable' }
  }
}

export function adoptDocumentDraft(
  storage: DraftStorage,
  scope: DraftScope,
  draftId: string,
): DraftRestore {
  const match = scanPayloads(storage, scope).find(
    (record) => record.draftId === draftId,
  )
  if (!match) return { status: 'empty' }
  const adopted = adoptRecord(storage, match, scope.tabId)
  return {
    status: 'restored',
    state: adopted.snapshot.state,
    held: adopted.snapshot.held,
    trackChangesFlip: adopted.snapshot.trackChangesFlip,
    draftId: adopted.draftId,
  }
}

const parseSnapshot = parseDraftSnapshot

function expired(updatedAt: string) {
  const written = Date.parse(updatedAt)
  return !Number.isFinite(written) || Date.now() - written > EXPIRY_MS
}

export function writeDocumentDraft(
  storage: DraftStorage,
  scope: DraftScope,
  snapshot: {
    baseVersionId: string
    state: DraftState
    held: HeldChange[]
    trackChangesFlip?: boolean
  },
): boolean {
  if (writesSuspended) return false
  const active = scanPayloads(storage, scope).find(
    (record) => record.writerId === scope.tabId && record.status === 'active',
  )
  const draftId = active?.draftId ?? newTabId()
  const payload: DocumentDraftSnapshot = {
    schemaVersion: DOCUMENT_DRAFT_SCHEMA_VERSION,
    organisationId: scope.organisationId,
    userId: scope.userId,
    documentId: scope.documentId,
    draftId,
    writerId: scope.tabId,
    status: 'active',
    baseVersionId: snapshot.baseVersionId,
    updatedAt: new Date().toISOString(),
    state: snapshot.state,
    held: snapshot.held,
    ...(snapshot.trackChangesFlip !== undefined
      ? { trackChangesFlip: snapshot.trackChangesFlip }
      : {}),
  }
  try {
    storage.setItem(documentDraftKey(scope, draftId), JSON.stringify(payload))
    return true
  } catch {
    return false
  }
}

export function clearDocumentDraft(storage: DraftStorage, scope: DraftScope) {
  for (const record of scanPayloads(storage, scope)) {
    if (record.writerId !== scope.tabId || record.status !== 'active') continue
    removeKey(storage, record.key)
  }
  listDocumentDrafts(storage, scope)
}

export function discardDocumentDrafts(
  storage: DraftStorage,
  scope: DraftScope,
) {
  for (const record of scanPayloads(storage, scope)) {
    if (record.status !== 'parked') continue
    removeKey(storage, record.key)
  }
  removeKey(storage, documentStaleDraftKey(scope))
  listDocumentDrafts(storage, scope)
}

export function discardRecoverableDraft(
  storage: DraftStorage,
  scope: Omit<DraftScope, 'tabId'>,
  draftId: string,
) {
  removeKey(storage, documentDraftKey({ ...scope, tabId: draftId }, draftId))
  listDocumentDrafts(storage, scope)
}

export function clearAllDocumentDrafts(storage: DraftStorage) {
  clearDocumentDraftsMatching(storage, () => true)
}

function clearDocumentDraftsForUser(storage: DraftStorage, userId: string) {
  clearDocumentDraftsMatching(storage, (key) => keyIncludesUser(key, userId))
}

export function clearStoredDocumentDrafts() {
  if (typeof window === 'undefined') return
  try {
    if (rememberedUserId) {
      clearDocumentDraftsForUser(window.localStorage, rememberedUserId)
    }
  } catch {
    // Storage access can throw in locked-down browser modes.
  }
}

export function clearStoredDocumentDraftsForUser(userId: string) {
  if (typeof window === 'undefined') return
  try {
    clearDocumentDraftsForUser(window.localStorage, userId)
  } catch {
    // As above.
  }
}

type Scanned = {
  key: string
  draftId: string
  writerId: string
  status: 'active' | 'parked'
  snapshot: DocumentDraftSnapshot
}

function scanPayloads(
  storage: DraftStorage,
  scope: Omit<DraftScope, 'tabId'>,
): Scanned[] {
  const prefix = [
    DOCUMENT_DRAFT_KEY_PREFIX,
    String(DOCUMENT_DRAFT_SCHEMA_VERSION),
    scope.organisationId,
    scope.userId,
    scope.documentId,
    '',
  ].join('.')
  const found: Scanned[] = []
  for (const key of allKeys(storage)) {
    if (
      key.startsWith(`${CLAIM_PREFIX}.`) ||
      key.startsWith(`${REGISTRY_PREFIX}.`)
    ) {
      continue
    }
    if (!key.startsWith(prefix)) continue
    const suffix = key.slice(prefix.length)
    const parkedBySuffix = suffix.endsWith('.stale')
    const draftId = parkedBySuffix ? suffix.slice(0, -'.stale'.length) : suffix
    if (!draftId || draftId.includes('.')) continue
    const raw = storage.getItem(key)
    if (raw === null) continue
    const parsed = parseSnapshot(raw)
    if (
      !parsed ||
      parsed.organisationId !== scope.organisationId ||
      parsed.userId !== scope.userId ||
      parsed.documentId !== scope.documentId
    ) {
      removeKey(storage, key)
      continue
    }
    found.push({
      key,
      draftId: parsed.draftId ?? draftId,
      writerId: parsed.writerId ?? draftId,
      status:
        parkedBySuffix || parsed.status === 'parked' ? 'parked' : 'active',
      snapshot: parsed,
    })
  }
  return found
}

function toRecoverable(record: Scanned): RecoverableDraft {
  return {
    draftId: record.draftId,
    writerId: record.writerId,
    baseVersionId: record.snapshot.baseVersionId,
    updatedAt: record.snapshot.updatedAt,
    status: record.status,
  }
}

function parkRecord(storage: DraftStorage, record: Scanned) {
  const parked: DocumentDraftSnapshot = {
    ...record.snapshot,
    draftId: record.draftId,
    writerId: record.writerId,
    status: 'parked',
  }
  try {
    storage.setItem(record.key, JSON.stringify(parked))
  } catch {
    // Leave the payload; it is still never applied to a newer version.
  }
}

function adoptRecord(
  storage: DraftStorage,
  record: Scanned,
  writerId: string,
): Scanned {
  const next: DocumentDraftSnapshot = {
    ...record.snapshot,
    draftId: record.draftId,
    writerId,
    status: 'active',
  }
  try {
    storage.setItem(record.key, JSON.stringify(next))
  } catch {
    // Adoption is still returned from memory; the next write retries.
  }
  return { ...record, writerId, snapshot: next, status: 'active' }
}
