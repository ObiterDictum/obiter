import { getDocument } from '@obiter/search-client'

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
