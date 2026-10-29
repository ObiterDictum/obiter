export const meilisearchDocumentPayloadMaxBytes = 80_000_000

export function utf8JsonBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf8')
}

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
