import { createCanonicalProvisionPath } from '@obiter/contracts/legislation-paths'

export type ProvisionResultLocation = {
  to: '/ln/$'
  params: { _splat: string }
  href: string
}

export function provisionResultLocation(result: {
  documentIdentity: string
  labelPath: string
  canonicalUrl?: string | null
}): ProvisionResultLocation {
  const splat = result.labelPath
    ? `${result.documentIdentity}/${result.labelPath}`
    : result.documentIdentity
  const href =
    result.canonicalUrl ??
    createCanonicalProvisionPath(result.documentIdentity, result.labelPath)
  return {
    to: '/ln/$',
    params: { _splat: splat },
    href,
  }
}
