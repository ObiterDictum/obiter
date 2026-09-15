import { z } from 'zod'
import { documentTextRunWireSchema } from '@obiter/contracts'
import type { DraftState } from './document-save-plan'
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
  DOCUMENT_DRAFT_CLAIM_TTL_MS,
  DOCUMENT_DRAFT_KEY_PREFIX,
  DOCUMENT_DRAFT_SCHEMA_VERSION,
  documentDraftKey,
  documentDraftTabId,
  documentStaleDraftKey,
  releaseDocumentDraftWriterClaim,
  resolveDocumentDraftWriter,
  touchDocumentDraftWriterClaim,
  type DraftScope,
  type DraftStorage,
  type RecoverableDraft,
} from './document-draft-identity'

/**
 * Browser persistence for unsaved document drafts.
 *
 * Draft payloads are privileged matter text. They are keyed by organisation,
 * user, document and a unique draft id; a per-tab writer id is stored only as
 * an occupant, never as the only way to find the payload. Document ids are
 * globally unique (`matter_documents.id` is a primary key).
 */
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000

export const localInsertSchema = z
  .object({
    clientId: z.string().min(1),
    afterParagraphId: z.string().min(1),
    text: z.string(),
    runs: z.array(documentTextRunWireSchema).optional(),
  })
  .strict()

const pendingEmphasisSchema = z
  .object({
    runId: z.string().min(1).optional(),
    paragraphId: z.string().min(1).optional(),
    from: z.number().int().min(0).optional(),
    to: z.number().int().min(0).optional(),
    bold: z.boolean().nullable().optional(),
    italic: z.boolean().nullable().optional(),
    underline: z.boolean().nullable().optional(),
  })
  .strict()

const numberingDraftSchema = z
  .object({
    numId: z.string().min(1).nullable(),
    ilvl: z.number().int().min(0).max(8).optional(),
  })
  .strict()

export const draftStateSchema = z
  .object({
    drafts: z.record(z.string(), z.string()),
    inserts: z.array(localInsertSchema),
    deletedParagraphIds: z.array(z.string().min(1)),
    extraRuns: z.record(z.string(), z.array(documentTextRunWireSchema)),
    format: z
      .object({
        emphasis: z.array(pendingEmphasisSchema),
        paragraphStyles: z.record(z.string(), z.string().min(1).nullable()),
        numbering: z.record(z.string(), numberingDraftSchema),
      })
      .strict(),
  })
  .strict()

const heldChangeSchema = z
  .object({
    id: z.string().min(1),
    label: z.string(),
    reason: z.string(),
    createdAt: z.string(),
    state: draftStateSchema,
  })
  .strict()

const snapshotSchema = z
  .object({
    schemaVersion: z.literal(DOCUMENT_DRAFT_SCHEMA_VERSION),
    organisationId: z.string().min(1),
    userId: z.string().min(1),
    documentId: z.string().min(1),
    draftId: z.string().min(1).optional(),
    writerId: z.string().min(1).optional(),
    status: z.enum(['active', 'parked']).optional(),
    baseVersionId: z.string().min(1),
    updatedAt: z.string(),
    state: draftStateSchema,
    held: z.array(heldChangeSchema),
  })
  .strict()

export type HeldChange = z.infer<typeof heldChangeSchema>
export type DocumentDraftSnapshot = z.infer<typeof snapshotSchema>

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

/** Parked drafts and abandoned writers only; a live sibling tab is not offered. */
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
    draftId: adopted.draftId,
  }
}

function parseSnapshot(raw: string): DocumentDraftSnapshot | null {
  try {
    const result = snapshotSchema.safeParse(JSON.parse(raw))
    return result.success ? result.data : null
  } catch {
    return null
  }
}

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

/** Removes only parked drafts for this document; live work stays. */
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

export function clearDocumentDraftsForUser(
  storage: DraftStorage,
  userId: string,
) {
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
