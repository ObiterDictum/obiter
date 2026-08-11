import type { DocumentCursor, DocumentPresence } from '@obiter/contracts'
import { DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT } from '@obiter/contracts'
import { parseDocx } from '@obiter/ooxml'
import { createDocumentObjectKey, type DocumentVersionRecord } from './database'
import type { StorageService } from './storage'

const PRESENCE_DOCUMENT_MAX_COUNT = 1_000
const PRESENCE_EXPIRY_MS = 15_000

type PresenceEntry = {
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

export class DocumentPresenceRegistry {
  private readonly buckets = new Map<string, PresenceBucket>()

  constructor(private readonly now: () => number = Date.now) {}

  update(
    organisationId: string,
    documentId: string,
    userId: string,
    cursor: DocumentCursor | null,
  ) {
    const now = this.now()
    this.removeExpired(now)
    const key = bucketKey(organisationId, documentId)
    const existing = this.buckets.get(key)

    if (cursor === null) {
      if (!existing) return
      existing.participants.delete(userId)
      if (existing.participants.size === 0) this.buckets.delete(key)
      return
    }

    const bucket = existing ?? this.createBucket(key)
    if (
      !bucket.participants.has(userId) &&
      bucket.participants.size >= DOCUMENT_COLLABORATION_PARTICIPANT_MAX_COUNT
    ) {
      const oldest = [...bucket.participants.entries()].sort(
        ([leftUserId, left], [rightUserId, right]) =>
          left.expiresAt - right.expiresAt ||
          compareUserIds(leftUserId, rightUserId),
      )[0]
      if (oldest) bucket.participants.delete(oldest[0])
    }
    bucket.participants.set(userId, {
      cursor: { ...cursor },
      expiresAt: now + PRESENCE_EXPIRY_MS,
    })
    this.touch(key, bucket)
  }

  read(organisationId: string, documentId: string): DocumentPresence[] {
    const now = this.now()
    this.removeExpired(now)
    const key = bucketKey(organisationId, documentId)
    const bucket = this.buckets.get(key)
    if (!bucket) return []
    this.touch(key, bucket)
    return [...bucket.participants.entries()]
      .sort(([left], [right]) => compareUserIds(left, right))
      .map(([userId, entry]) => ({
        userId,
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
      for (const [userId, entry] of bucket.participants) {
        if (entry.expiresAt <= now) bucket.participants.delete(userId)
      }
      if (bucket.participants.size === 0) this.buckets.delete(key)
    }
  }

  private touch(key: string, bucket: PresenceBucket) {
    this.buckets.delete(key)
    this.buckets.set(key, bucket)
  }
}

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
  if (version.objectKey !== expectedKey || !storage.readBinary) {
    throw new DocumentPresenceReadError()
  }

  try {
    const source = await storage.readBinary(version.objectKey)
    const document = await parseDocx(source)
    const paragraph = document.model.stories
      .find(({ kind }) => kind === 'document')
      ?.paragraphs.find(({ id }) => id === cursor.paragraphId)
    const run = paragraph?.runs.find(({ id }) => id === cursor.runId)
    return run !== undefined && cursor.offset <= run.text.length
  } catch {
    throw new DocumentPresenceReadError()
  }
}

function compareUserIds(left: string, right: string) {
  if (left === right) return 0
  return left < right ? -1 : 1
}

function bucketKey(organisationId: string, documentId: string) {
  return JSON.stringify([organisationId, documentId])
}
