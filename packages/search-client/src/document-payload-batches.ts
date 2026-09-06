/**
 * Meilisearch rejects POST /indexes/.../documents with payload_too_large when
 * the HTTP body exceeds `http-payload-size-limit` (default 100_000_000 bytes).
 * The SDK sends `JSON.stringify(documents)` as that body. 80_000_000 leaves
 * 20 MB for headers, transfer encoding, and any extra framing so a measured
 * batch cannot sit on the 100 MB knife-edge.
 */
export const meilisearchDocumentPayloadMaxBytes = 80_000_000

export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

/**
 * Splits records so each `JSON.stringify(batch)` stays at or under `maxBytes`.
 * A JSON array is `'[' + items.join(',') + ']'`, so running totals match the
 * HTTP body without re-serializing the whole batch on every append.
 */
export function partitionByUtf8JsonPayload<T>(
  documents: readonly T[],
  maxBytes: number,
): T[][] {
  const batches: T[][] = []
  let current: T[] = []
  let currentBytes = 2

  for (const document of documents) {
    const itemBytes = utf8JsonBytes(document)
    const asSoleBatch = itemBytes + 2
    if (asSoleBatch > maxBytes) {
      throw new Error(oversizedDocumentMessage(document, asSoleBatch, maxBytes))
    }

    const extra = current.length === 0 ? itemBytes : itemBytes + 1
    if (currentBytes + extra <= maxBytes) {
      current.push(document)
      currentBytes += extra
      continue
    }

    batches.push(current)
    current = [document]
    currentBytes = asSoleBatch
  }

  if (current.length > 0) batches.push(current)
  return batches
}

function oversizedDocumentMessage(
  document: unknown,
  bytes: number,
  maxBytes: number,
): string {
  const recordId =
    typeof document === 'object' &&
    document !== null &&
    'id' in document &&
    typeof document.id === 'string'
      ? document.id
      : null
  const idLabel = recordId === null ? 'unknown id' : recordId
  return `Document ${idLabel} serialises to ${String(bytes)} bytes, which exceeds the ${String(maxBytes)} byte Meilisearch payload cap.`
}
