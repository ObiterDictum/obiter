const KEY_PREFIX = 'obiter.pending-citation.v1.'

export type PendingCitation = {
  documentId: string
  requestId: string
  text: string
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    return null
  }
}

export function requestCitation(documentId: string, text: string) {
  const request: PendingCitation = {
    documentId,
    requestId: crypto.randomUUID(),
    text,
  }
  try {
    storage()?.setItem(`${KEY_PREFIX}${documentId}`, JSON.stringify(request))
  } catch {
    // The store is full or blocked: the document opens with no pending
    // citation rather than failing the navigation.
  }
  return request
}

export function readPendingCitation(
  documentId: string,
): PendingCitation | null {
  try {
    const raw = storage()?.getItem(`${KEY_PREFIX}${documentId}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    // SAFETY: every field this reads is checked below; a stored value that
    const {
      documentId: target,
      requestId,
      text,
    } = parsed as Record<string, unknown>
    if (
      target !== documentId ||
      typeof requestId !== 'string' ||
      typeof text !== 'string' ||
      text === ''
    )
      return null
    return { documentId, requestId, text }
  } catch {
    return null
  }
}

export function clearPendingCitation(documentId: string) {
  try {
    storage()?.removeItem(`${KEY_PREFIX}${documentId}`)
  } catch {
    // Nothing to do: a store that cannot be written cannot hold a stale one.
  }
}
