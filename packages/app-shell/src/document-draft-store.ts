import { z } from 'zod'
import { documentTextRunWireSchema } from '@obiter/contracts'
import type { DraftState } from './document-save-plan'

/**
 * Browser persistence for unsaved document drafts.
 *
 * E45: drafts lived only in React state, so a reload destroyed an afternoon of
 * typing with no warning. The stored payload is privileged matter text, so it
 * is deliberately minimal (only changed runs and pending edits, never the
 * document model), versioned, scope-keyed, and validated on every read. A
 * payload that fails validation is dropped rather than applied.
 */
export const DOCUMENT_DRAFT_SCHEMA_VERSION = 1
export const DOCUMENT_DRAFT_KEY_PREFIX = 'obiter.document-draft'
const TAB_ID_KEY = 'obiter.document-draft.tab'
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
    baseVersionId: z.string().min(1),
    updatedAt: z.string(),
    state: draftStateSchema,
    held: z.array(heldChangeSchema),
  })
  .strict()

export type HeldChange = z.infer<typeof heldChangeSchema>
export type DocumentDraftSnapshot = z.infer<typeof snapshotSchema>

export type DraftScope = {
  organisationId: string
  userId: string
  documentId: string
  tabId: string
}

/** The subset of the Web Storage API this module needs. */
export interface DraftStorage {
  readonly length: number
  key(index: number): string | null
  getItem(key: string): string | null
  setItem(key: string, value: string): void
  removeItem(key: string): void
}

export function documentDraftKey(scope: DraftScope) {
  return [
    DOCUMENT_DRAFT_KEY_PREFIX,
    String(DOCUMENT_DRAFT_SCHEMA_VERSION),
    scope.organisationId,
    scope.userId,
    scope.documentId,
    scope.tabId,
  ].join('.')
}

/**
 * Where a draft recorded against a version the server has moved past is parked.
 * It is kept out of the active key so new unsaved work in the same tab can still
 * be preserved, and it is removed only when the user discards it.
 */
export function documentStaleDraftKey(scope: DraftScope) {
  return `${documentDraftKey(scope)}.stale`
}

/**
 * A per-tab id keeps two tabs on one document from overwriting each other's
 * draft, and lets a reload in the same tab find its own. sessionStorage is the
 * right lifetime: closing the tab drops it, so nothing is shared afterwards.
 */
export function documentDraftTabId(storage: DraftStorage | null) {
  if (storage) {
    try {
      const existing = storage.getItem(TAB_ID_KEY)
      if (existing) return existing
      const created = newTabId()
      storage.setItem(TAB_ID_KEY, created)
      return created
    } catch {
      // Fall through to a per-page id when sessionStorage is unavailable.
    }
  }
  memoryTabId ??= newTabId()
  return memoryTabId
}

let memoryTabId: string | null = null

function newTabId() {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${String(Date.now())}-${String(Math.random())}`
}

export type DraftRestore =
  | { status: 'empty' }
  | { status: 'restored'; state: DraftState; held: HeldChange[] }
  | { status: 'stale'; baseVersionId: string }
  | { status: 'unavailable' }

/**
 * Reads the draft for this scope. A draft recorded against a different stored
 * version is never applied: the operations address nodes from that version, so
 * applying them to a newer one is how drafts silently corrupt a document. It is
 * reported as `stale` so the caller can disclose it and offer a discard.
 */
export function readDocumentDraft(
  storage: DraftStorage,
  scope: DraftScope,
  currentVersionId: string,
): DraftRestore {
  let raw: string | null
  try {
    raw = storage.getItem(documentDraftKey(scope))
  } catch {
    return { status: 'unavailable' }
  }
  if (raw === null) return { status: 'empty' }
  const parsed = parseSnapshot(raw)
  if (
    !parsed ||
    parsed.organisationId !== scope.organisationId ||
    parsed.userId !== scope.userId ||
    parsed.documentId !== scope.documentId
  ) {
    clearDocumentDraft(storage, scope)
    return { status: 'empty' }
  }
  if (expired(parsed.updatedAt)) {
    clearDocumentDraft(storage, scope)
    return { status: 'empty' }
  }
  if (parsed.baseVersionId !== currentVersionId) {
    // Park it rather than leaving it in the active key: the tab can still
    // accumulate new unsaved work, and the stale draft must survive until the
    // user discards it.
    try {
      storage.setItem(documentStaleDraftKey(scope), raw)
      storage.removeItem(documentDraftKey(scope))
    } catch {
      // A store that refuses the move leaves the draft in place; it is still
      // reported as stale and still never applied.
    }
    return { status: 'stale', baseVersionId: parsed.baseVersionId }
  }
  return { status: 'restored', state: parsed.state, held: parsed.held }
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

/** Returns false when storage refused the write (quota, disabled, private mode). */
export function writeDocumentDraft(
  storage: DraftStorage,
  scope: DraftScope,
  snapshot: {
    baseVersionId: string
    state: DraftState
    held: HeldChange[]
  },
): boolean {
  const payload: DocumentDraftSnapshot = {
    schemaVersion: DOCUMENT_DRAFT_SCHEMA_VERSION,
    organisationId: scope.organisationId,
    userId: scope.userId,
    documentId: scope.documentId,
    baseVersionId: snapshot.baseVersionId,
    updatedAt: new Date().toISOString(),
    state: snapshot.state,
    held: snapshot.held,
  }
  try {
    storage.setItem(documentDraftKey(scope), JSON.stringify(payload))
    return true
  } catch {
    // Never log the payload: it contains matter text.
    return false
  }
}

export function clearDocumentDraft(storage: DraftStorage, scope: DraftScope) {
  try {
    storage.removeItem(documentDraftKey(scope))
  } catch {
    // A storage that refuses removal leaves a draft that expiry will drop.
  }
}

/**
 * Removes the active draft and any parked draft for this scope. This is the
 * explicit discard path, so it is the one place that drops both.
 */
export function discardDocumentDrafts(
  storage: DraftStorage,
  scope: DraftScope,
) {
  clearDocumentDraft(storage, scope)
  try {
    storage.removeItem(documentStaleDraftKey(scope))
  } catch {
    // As above: expiry still bounds anything left behind.
  }
}

/**
 * Drops every stored draft. Called on sign-out so one user's matter text can
 * never be offered to the next session that opens the same document.
 */
export function clearAllDocumentDrafts(storage: DraftStorage) {
  try {
    const keys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (key?.startsWith(`${DOCUMENT_DRAFT_KEY_PREFIX}.`)) keys.push(key)
    }
    keys.forEach((key) => storage.removeItem(key))
  } catch {
    // Best effort: expiry still bounds anything left behind.
  }
}

/** Sign-out entry point; a browser without local storage has nothing to clear. */
export function clearStoredDocumentDrafts() {
  if (typeof window === 'undefined') return
  try {
    clearAllDocumentDrafts(window.localStorage)
  } catch {
    // Storage access can throw in locked-down browser modes.
  }
}
