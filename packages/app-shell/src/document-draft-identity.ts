export const DOCUMENT_DRAFT_SCHEMA_VERSION = 1
export const DOCUMENT_DRAFT_KEY_PREFIX = 'obiter.document-draft'
const DOCUMENT_DRAFT_CLAIM_TTL_MS = 2000
const WRITER_SESSION_KEY = 'obiter.document-draft.tab'
export const CLAIM_PREFIX = 'obiter.document-draft.claim'
export const REGISTRY_PREFIX = 'obiter.document-draft.registry'

export type DraftScope = {
  organisationId: string
  userId: string
  documentId: string
  tabId: string
}

export type RecoverableDraft = {
  draftId: string
  writerId: string
  baseVersionId: string
  updatedAt: string
  status: 'active' | 'parked'
}

export interface DraftStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function documentDraftKey(scope: DraftScope, draftId = scope.tabId) {
  return [
    DOCUMENT_DRAFT_KEY_PREFIX,
    String(DOCUMENT_DRAFT_SCHEMA_VERSION),
    scope.organisationId,
    scope.userId,
    scope.documentId,
    draftId,
  ].join('.')
}

export function documentStaleDraftKey(scope: DraftScope) {
  return `${documentDraftKey(scope)}.stale`
}

function registryKey(
  organisationId: string,
  userId: string,
  documentId: string,
) {
  return [
    REGISTRY_PREFIX,
    String(DOCUMENT_DRAFT_SCHEMA_VERSION),
    organisationId,
    userId,
    documentId,
  ].join('.')
}

function claimKey(writerId: string) {
  return `${CLAIM_PREFIX}.${writerId}`
}

export function documentDraftTabId(storage: DraftStorage | null) {
  if (storage) {
    try {
      const existing = storage.getItem(WRITER_SESSION_KEY)
      if (existing) return existing
      const created = newTabId()
      storage.setItem(WRITER_SESSION_KEY, created)
      return created
    } catch {}
  }
  memoryTabId ??= newTabId()
  return memoryTabId
}

export function resolveDocumentDraftWriter(
  session: DraftStorage | null,
  local: DraftStorage | null,
  instanceId: string,
  now = Date.now(),
): string {
  const existing = documentDraftTabId(session)
  const claim = readClaim(local, existing)
  if (
    claim &&
    claim.instanceId !== instanceId &&
    now - claim.at < DOCUMENT_DRAFT_CLAIM_TTL_MS
  ) {
    const forked = newTabId()
    try {
      session?.setItem(WRITER_SESSION_KEY, forked)
    } catch {}
    writeClaim(local, forked, instanceId, now)
    return forked
  }
  writeClaim(local, existing, instanceId, now)
  return existing
}

export function touchDocumentDraftWriterClaim(
  local: DraftStorage | null,
  writerId: string,
  instanceId: string,
  now = Date.now(),
) {
  writeClaim(local, writerId, instanceId, now)
}

export function releaseDocumentDraftWriterClaim(
  local: DraftStorage | null,
  writerId: string,
  instanceId: string,
) {
  const claim = readClaim(local, writerId)
  if (!claim || claim.instanceId !== instanceId) return
  try {
    local?.removeItem(claimKey(writerId))
  } catch {}
}

export function writerIsLive(
  storage: DraftStorage,
  writerId: string,
  now = Date.now(),
) {
  const claim = readClaim(storage, writerId)
  return Boolean(claim && now - claim.at < DOCUMENT_DRAFT_CLAIM_TTL_MS)
}

export function allKeys(storage: DraftStorage) {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (key) keys.push(key)
  }
  return keys
}

export function removeKey(storage: DraftStorage, key: string) {
  try {
    storage.removeItem(key)
  } catch {}
}

function readClaim(storage: DraftStorage | null, writerId: string) {
  if (!storage) return null
  try {
    const raw = storage.getItem(claimKey(writerId))
    if (!raw) return null
    // SAFETY: storage holds only claims written by writeClaim in this module as { instanceId: string, at: number }; both fields are typeof-checked below and anything else returns null.
    const parsed = JSON.parse(raw) as { instanceId?: unknown; at?: unknown }
    if (
      typeof parsed.instanceId !== 'string' ||
      typeof parsed.at !== 'number'
    ) {
      return null
    }
    return { instanceId: parsed.instanceId, at: parsed.at }
  } catch {
    return null
  }
}

function writeClaim(
  storage: DraftStorage | null,
  writerId: string,
  instanceId: string,
  now: number,
) {
  if (!storage) return
  try {
    storage.setItem(claimKey(writerId), JSON.stringify({ instanceId, at: now }))
  } catch {}
}

export function newTabId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${String(Date.now())}-${String(Math.random())}`
}

export function writeRegistry(
  storage: DraftStorage,
  organisationId: string,
  userId: string,
  documentId: string,
  entries: RecoverableDraft[],
) {
  try {
    storage.setItem(
      registryKey(organisationId, userId, documentId),
      JSON.stringify({ schemaVersion: DOCUMENT_DRAFT_SCHEMA_VERSION, entries }),
    )
  } catch {}
}

export function clearDocumentDraftsMatching(
  storage: DraftStorage,
  keep: (key: string) => boolean,
) {
  try {
    for (const key of allKeys(storage)) {
      if (
        (key.startsWith(`${DOCUMENT_DRAFT_KEY_PREFIX}.`) ||
          key.startsWith(`${CLAIM_PREFIX}.`) ||
          key.startsWith(`${REGISTRY_PREFIX}.`)) &&
        keep(key)
      ) {
        storage.removeItem(key)
      }
    }
  } catch {}
}

export function keyIncludesUser(key: string, userId: string) {
  return key.split('.').includes(userId)
}

let memoryTabId: string | null = null
