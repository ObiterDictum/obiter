/**
 * Resolves a legislation search hit into a TanStack Router location.
 * Uses the splat `/ln/$` so the URL keeps the official identity path.
 */
export function provisionResultLocation(result: {
  documentIdentity: string
  labelPath: string
  canonicalUrl?: string | null
}): { to: '/ln/$'; params: { _splat: string }; href: string } {
  const splat = result.labelPath
    ? `${result.documentIdentity}/${result.labelPath}`
    : result.documentIdentity
  const href = result.canonicalUrl ?? `/ln/${splat}`
  return {
    to: '/ln/$',
    params: { _splat: splat },
    href,
  }
}
