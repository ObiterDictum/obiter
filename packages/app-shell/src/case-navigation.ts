/**
 * Resolves a legal-search hit into a TanStack Router location.
 * Prefer this over raw `<a href>` / `navigate({ href })` so hash history
 * (desktop Electron) and path history (web) both stay in-router.
 */
export function caseResultLocation(result: {
  id: string
  canonicalUrl?: string | null
}):
  | { to: '/case/$caseSlug'; params: { caseSlug: string } }
  | { to: '/cases/$caseId'; params: { caseId: string } } {
  const path = result.canonicalUrl ?? `/cases/${encodeURIComponent(result.id)}`

  if (path.startsWith('/case/')) {
    return {
      to: '/case/$caseSlug',
      params: { caseSlug: path.slice('/case/'.length) },
    }
  }

  if (path.startsWith('/cases/')) {
    return {
      to: '/cases/$caseId',
      params: { caseId: decodeURIComponent(path.slice('/cases/'.length)) },
    }
  }

  // Defensive fallback: treat unknown shapes as opaque case ids.
  return {
    to: '/cases/$caseId',
    params: { caseId: result.id },
  }
}
