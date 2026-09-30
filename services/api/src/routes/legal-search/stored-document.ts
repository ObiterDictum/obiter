import { getDocument } from '@obiter/search-client'

/**
 * Corpus-only stored document read.
 *
 * The derived index serves a stored judgment's full text; Postgres remains the
 * record. This module has no provider path: a miss, timeout or engine error
 * returns null so the route answers with an honest local-corpus miss instead
 * of reaching Find Case Law. National Archives access belongs to an explicit
 * indexing run, never to a user request.
 */

// Bounds the index lookup: sized for a single document fetch, so a slow or
// unreachable engine fails visibly as a miss rather than holding the route.
const storedDocumentTimeoutMs = 350

export async function getStoredAuthorityDocument(
  indexClient: Parameters<typeof getDocument>[0],
  indexName: string,
  documentId: string,
) {
  try {
    return await withTimeout(
      getDocument(indexClient, indexName, documentId),
      storedDocumentTimeoutMs,
    )
  } catch {
    return null
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  let timeout: ReturnType<typeof setTimeout>

  return Promise.race([
    promise.finally(() => clearTimeout(timeout)),
    new Promise<never>((_, reject) => {
      timeout = setTimeout(
        () => reject(new Error('Stored document lookup timed out.')),
        timeoutMs,
      )
    }),
  ])
}
