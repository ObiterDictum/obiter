export { readInitialSearchQuery, readSearchErrorMessage, isTextEntryTarget }

/**
 * Names the failure the API reported so the error panel never shows a
 * generic message for a specific outage. The error code is read from the
 * body, not the status alone: a 503 can name the search index or the
 * legal-source store, and only the code says which one is down. A 503 with
 * no recognised code is an infrastructure outage, and is reported as one
 * rather than blamed on a provider the corpus-only API never calls.
 */
async function readSearchErrorMessage(response: Response): Promise<string> {
  if (response.status === 429) {
    return 'Search is busy. Try again shortly.'
  }
  if (response.status !== 503) {
    return 'Search could not complete the request.'
  }
  const code = await response
    .json()
    .then(
      (body: unknown) =>
        // SAFETY: body is only probed for error.code via optional chaining and compared to a literal; any other shape falls through to the generic message.
        (body as { error?: { code?: unknown } } | null)?.error?.code,
    )
    .catch(() => undefined)
  if (code === 'search_unavailable') {
    return 'Legal search is temporarily unavailable because the search index cannot be reached. Try again later.'
  }
  if (code === 'search_incomplete') {
    return 'Legal search could not be completed because part of the search failed. Try again later.'
  }
  if (code === 'storage_unavailable') {
    return 'Legal search is temporarily unavailable because the legal-source store cannot be reached. Try again later.'
  }
  return 'Legal search is temporarily unavailable. Try again later.'
}

function isTextEntryTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false

  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  )
}

function readInitialSearchQuery() {
  if (typeof window === 'undefined') {
    return ''
  }

  const query =
    window.sessionStorage.getItem('obiter.search.initialQuery') ?? ''
  window.sessionStorage.removeItem('obiter.search.initialQuery')
  return query
}
