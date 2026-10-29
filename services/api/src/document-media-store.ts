import { readPackageImageParts, requestedImagePartName } from '@obiter/ooxml'
import { createDocumentObjectKey } from './document-database'
import { type DocumentVersionRecord } from './database-records'
import { DocumentDerivedStoreError } from './document-derived-store'
import type { StorageService } from './storage'

type DocumentMediaSource = Pick<
  DocumentVersionRecord,
  'id' | 'organisationId' | 'matterId' | 'matterDocumentId' | 'objectKey'
>
type ImagePart = { bytes: Uint8Array; contentType: string }
type ImagePartMap = ReadonlyMap<string, ImagePart>

const DOCUMENT_IMAGE_PART_CACHE_LIMIT = 16

const DOCUMENT_IMAGE_PART_CACHE_MAX_BYTES = 64 * 1024 * 1024

export type DocumentImagePartCache = {
  get(key: string): Promise<ImagePartMap> | undefined
  set(key: string, value: Promise<ImagePartMap>): void
  delete(key: string): boolean
}

export function retainedImagePartBytes(parts: ImagePartMap): number {
  const buffers = new Set<ArrayBufferLike>()
  let total = 0
  for (const part of parts.values()) {
    if (buffers.has(part.bytes.buffer)) continue
    buffers.add(part.bytes.buffer)
    total += part.bytes.buffer.byteLength
  }
  return total
}

export class DocumentMediaStoreError extends DocumentDerivedStoreError {
  constructor() {
    super('The document image could not be read.')
  }
}

type ImagePartEntry = {
  promise: Promise<ImagePartMap>
  bytes: number
  counted: boolean
}

export function createDocumentImagePartCache(
  limit = DOCUMENT_IMAGE_PART_CACHE_LIMIT,
  maxBytes = DOCUMENT_IMAGE_PART_CACHE_MAX_BYTES,
): DocumentImagePartCache {
  const cap = Math.max(1, limit)
  const byteCap = Math.max(0, maxBytes)
  const entries = new Map<string, ImagePartEntry>()
  let retainedBytes = 0

  const release = (entry: ImagePartEntry) => {
    if (!entry.counted) return
    retainedBytes -= entry.bytes
    entry.counted = false
  }

  const trim = () => {
    while (entries.size > cap || retainedBytes > byteCap) {
      const oldestKey = entries.keys().next().value
      if (oldestKey === undefined) break
      const oldest = entries.get(oldestKey)
      if (!oldest) break
      entries.delete(oldestKey)
      release(oldest)
    }
  }

  const record = (key: string, entry: ImagePartEntry, parts: ImagePartMap) => {
    if (entries.get(key) !== entry) return
    const bytes = retainedImagePartBytes(parts)
    if (bytes > byteCap) {
      entries.delete(key)
      return
    }
    entry.bytes = bytes
    entry.counted = true
    retainedBytes += bytes
    trim()
  }

  return {
    get(key) {
      const entry = entries.get(key)
      if (!entry) return undefined
      entries.delete(key)
      entries.set(key, entry)
      return entry.promise
    },
    set(key, value) {
      const replaced = entries.get(key)
      if (replaced) {
        entries.delete(key)
        release(replaced)
      }
      const entry: ImagePartEntry = { promise: value, bytes: 0, counted: false }
      entries.set(key, entry)
      trim()
      value.then(
        (parts) => record(key, entry, parts),
        () => {
          if (entries.get(key) === entry) entries.delete(key)
        },
      )
    },
    delete(key) {
      const entry = entries.get(key)
      if (!entry) return false
      entries.delete(key)
      release(entry)
      return true
    },
  }
}

export async function getDocumentImagePart(
  storage: StorageService,
  source: DocumentMediaSource,
  partName: string,
  cache: DocumentImagePartCache = createDocumentImagePartCache(),
) {
  const expectedSourceKey = createDocumentObjectKey({
    organisationId: source.organisationId,
    matterId: source.matterId,
    documentId: source.matterDocumentId,
    versionId: source.id,
  })
  if (source.objectKey !== expectedSourceKey)
    throw new DocumentMediaStoreError()

  const cacheKey = `${source.id}:${expectedSourceKey}`
  let pending = cache.get(cacheKey)
  if (!pending) {
    pending = loadVersionImageParts(storage, expectedSourceKey)
    cache.set(cacheKey, pending)
  }
  return (await pending).get(requestedImagePartName(partName) ?? '')
}

async function loadVersionImageParts(
  storage: StorageService,
  objectKey: string,
) {
  try {
    if (!storage.readBinary) throw new DocumentMediaStoreError()
    const packageBytes = await storage.readBinary(objectKey)
    return await readPackageImageParts(packageBytes)
  } catch (error) {
    if (error instanceof DocumentMediaStoreError) throw error
    throw new DocumentMediaStoreError()
  }
}
