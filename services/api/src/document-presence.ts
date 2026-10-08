import type { DocumentCursor, DocumentPresence } from '@obiter/contracts'
import { DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT } from '@obiter/contracts'
import { createDocumentObjectKey, type DocumentVersionRecord } from './database'
import { getDocumentModel } from './document-model-store'
import type { StorageService } from './storage'

const PRESENCE_DOCUMENT_MAX_COUNT = 1_000
export const PRESENCE_EXPIRY_MS = 15_000

/** One heartbeat row's identity: document scope, account, and client tab. */
export interface DocumentPresenceScope {
  organisationId: string
  matterId: string
  documentId: string
  versionId: string
  userId: string
  clientId: string
}

/**
 * The collaboration route's presence seam. Production wires the Postgres
 * store (`PostgresDocumentPresence`) so presence is shared between API
 * instances; tests inject `DocumentPresenceRegistry`, the in-memory
 * implementation, when no database is available. Implementations may answer
 * synchronously — the route awaits either.
 *
 * `cursor: null` is a leave: it removes the caller's own (user, client)
 * heartbeat row only. Reads return live cursors anchored to the version the
 * reader resolved, so presence written against a superseded version stops
 * matching without a delete.
 */
export interface DocumentPresenceBackend {
  update(
    scope: DocumentPresenceScope,
    cursor: DocumentCursor | null,
  ): void | Promise<void>
  read(scope: {
    organisationId: string
    documentId: string
    versionId: string
  }): DocumentPresence[] | Promise<DocumentPresence[]>
}

type PresenceEntry = {
  userId: string
  clientId: string
  versionId: string
  cursor: DocumentCursor
  expiresAt: number
}

type PresenceBucket = {
  participants: Map<string, PresenceEntry>
}

export class DocumentPresenceReadError extends Error {
  constructor() {
    super('The document cursor could not be validated.')
    this.name = new.target.name
  }
}

export class DocumentPresenceRegistry implements DocumentPresenceBackend {
  private readonly buckets = new Map<string, PresenceBucket>()

  constructor(private readonly now: () => number = Date.now) {}

  update(scope: DocumentPresenceScope, cursor: DocumentCursor | null) {
    const now = this.now()
    this.removeExpired(now)
    const key = bucketKey(scope.organisationId, scope.documentId)
    const existing = this.buckets.get(key)
    const participantKey = participantKeyOf(scope.userId, scope.clientId)

    if (cursor === null) {
      if (!existing) return
      existing.participants.delete(participantKey)
      if (existing.participants.size === 0) this.buckets.delete(key)
      return
    }

    const bucket = existing ?? this.createBucket(key)
    if (
      !bucket.participants.has(participantKey) &&
      bucket.participants.size >= DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT
    ) {
      const oldest = [...bucket.participants.entries()].sort(
        ([leftKey, left], [rightKey, right]) =>
          left.expiresAt - right.expiresAt || compareStrings(leftKey, rightKey),
      )[0]
      if (oldest) bucket.participants.delete(oldest[0])
    }
    bucket.participants.set(participantKey, {
      userId: scope.userId,
      clientId: scope.clientId,
      versionId: scope.versionId,
      cursor: { ...cursor },
      expiresAt: now + PRESENCE_EXPIRY_MS,
    })
    this.touch(key, bucket)
  }

  read(scope: {
    organisationId: string
    documentId: string
    versionId: string
  }): DocumentPresence[] {
    const now = this.now()
    this.removeExpired(now)
    const key = bucketKey(scope.organisationId, scope.documentId)
    const bucket = this.buckets.get(key)
    if (!bucket) return []
    this.touch(key, bucket)
    return [...bucket.participants.values()]
      .filter((entry) => entry.versionId === scope.versionId)
      .sort(
        (left, right) =>
          compareStrings(left.userId, right.userId) ||
          compareStrings(left.clientId, right.clientId),
      )
      .map((entry) => ({
        userId: entry.userId,
        ...(entry.clientId === '' ? {} : { clientId: entry.clientId }),
        cursor: { ...entry.cursor },
      }))
  }

  private createBucket(key: string) {
    while (this.buckets.size >= PRESENCE_DOCUMENT_MAX_COUNT) {
      const oldest = this.buckets.keys().next().value
      if (oldest === undefined) break
      this.buckets.delete(oldest)
    }
    const bucket: PresenceBucket = { participants: new Map() }
    this.buckets.set(key, bucket)
    return bucket
  }

  private removeExpired(now: number) {
    for (const [key, bucket] of this.buckets) {
      for (const [participantKey, entry] of bucket.participants) {
        if (entry.expiresAt <= now) bucket.participants.delete(participantKey)
      }
      if (bucket.participants.size === 0) this.buckets.delete(key)
    }
  }

  private touch(key: string, bucket: PresenceBucket) {
    this.buckets.delete(key)
    this.buckets.set(key, bucket)
  }
}

/**
 * Validates a heartbeat cursor against the version it claims to point into.
 * The check runs on the stored, cached model — the same artifact /model
 * serves — so heartbeat validation never re-parses source bytes on the
 * serving loop.
 */
export async function validateDocumentCursor(
  storage: StorageService,
  version: DocumentVersionRecord,
  cursor: DocumentCursor,
) {
  const expectedKey = createDocumentObjectKey({
    organisationId: version.organisationId,
    matterId: version.matterId,
    documentId: version.matterDocumentId,
    versionId: version.id,
  })
  if (version.objectKey !== expectedKey) {
    throw new DocumentPresenceReadError()
  }

  let model
  try {
    model = await getDocumentModel(storage, version)
  } catch {
    throw new DocumentPresenceReadError()
  }
  const paragraph = model.stories
    .find(({ kind }) => kind === 'document')
    ?.paragraphs.find(({ id }) => id === cursor.paragraphId)
  const run = paragraph?.runs.find(({ id }) => id === cursor.runId)
  return run !== undefined && cursor.offset <= run.text.length
}

function participantKeyOf(userId: string, clientId: string) {
  return `${userId} ${clientId}`
}

function compareStrings(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function bucketKey(organisationId: string, documentId: string) {
  return JSON.stringify([organisationId, documentId])
}
