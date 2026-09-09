/**
 * Canonical provision URLs. A solicitor pastes these; they must stay readable
 * and stable. The path after `/ln/` is the legislation.gov.uk identity path
 * (`ukpga/2010/15/section/40`), not a title slug and not an opaque id.
 *
 * Title slugs collide (Finance Act every year) and can drift if a short title
 * is amended. Chapter identity does not. `/legislation/:id` nested API
 * routes are for machines; this shape is for humans.
 */

export function createCanonicalProvisionPath(
  documentIdentity: string,
  labelPath: string,
) {
  if (!labelPath) return `/ln/${documentIdentity}`
  return `/ln/${documentIdentity}/${labelPath}`
}

export function createCanonicalActPath(documentIdentity: string) {
  return `/ln/${documentIdentity}`
}

export function parseLegislationActPath(path: string): {
  documentIdentity: string
} | null {
  const trimmed = path.replace(/^\/ln\/?/, '').replace(/^\/+/, '')
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length !== 3) return null
  const [actType, year, number] = parts
  if (actType !== 'ukpga') return null
  if (!year || !/^\d{4}$/.test(year)) return null
  if (!number || !/^\d+$/.test(number)) return null
  return { documentIdentity: `${actType}/${year}/${number}` }
}

export function parseLegislationProvisionPath(path: string): {
  documentIdentity: string
  labelPath: string
  provisionId: string
} | null {
  const trimmed = path.replace(/^\/ln\/?/, '').replace(/^\/+/, '')
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length < 4) return null
  const [actType, year, number, ...labelParts] = parts
  if (actType !== 'ukpga') return null
  if (!year || !/^\d{4}$/.test(year)) return null
  if (!number || !/^\d+$/.test(number)) return null
  if (labelParts.length === 0) return null
  const labelPath = labelParts.join('/')
  const documentIdentity = `${actType}/${year}/${number}`
  return {
    documentIdentity,
    labelPath,
    provisionId: `${documentIdentity}/${labelPath}`,
  }
}
