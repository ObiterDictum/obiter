const KEY_PREFIX = 'obiter.pending-citation.v1.'

/**
 * A citation travelling from a source page to the document it will be typed
 * into. It is held in this tab's session storage under the document's own key
 * rather than in a store or in route state: it exists for that one document,
 * it is dropped as soon as it is inserted or dismissed, and no other document
 * can read it. Session storage is per tab, so a second reader of the same
 * browser profile never sees it either.
 */
export type PendingCitation = {
  documentId: string
  /** One per request, so asking twice for the same text is two requests. */
  requestId: string
  text: string
}

function storage(): Storage | null {
  if (typeof window === 'undefined') return null
  try {
    return window.sessionStorage
  } catch {
    // A blocked store is a browser setting, not an error to surface.
    return null
  }
}

/** Hold the citation for the document the reader is about to open. */
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

/** The citation waiting for this document, if a source page left one. */
export function readPendingCitation(
  documentId: string,
): PendingCitation | null {
  try {
    const raw = storage()?.getItem(`${KEY_PREFIX}${documentId}`)
    if (!raw) return null
    const parsed: unknown = JSON.parse(raw)
    if (parsed === null || typeof parsed !== 'object') return null
    // SAFETY: every field this reads is checked below; a stored value that
    // fails a check is treated as no request at all.
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

/** The request is answered — inserted or dismissed — so it is not offered again. */
export function clearPendingCitation(documentId: string) {
  try {
    storage()?.removeItem(`${KEY_PREFIX}${documentId}`)
  } catch {
    // Nothing to do: a store that cannot be written cannot hold a stale one.
  }
}
