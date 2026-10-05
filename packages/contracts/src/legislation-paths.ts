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

/**
 * True when the act type is one this repository stores. The URL grammar below
 * accepts a broader act-type segment because `legislation.gov.uk` identities
 * share the shape, so the supported set is stated once here and both parsers
 * apply it. Secondary legislation has its own tables and is out of scope.
 */
export function isSupportedLegislationActType(actType: string): boolean {
  return actType === 'ukpga'
}

/**
 * The first year of the Parliament of the United Kingdom, whose Public General
 * Acts are the `ukpga` corpus this repository stores. Acts from before the 1801
 * union carry different act types that this repository does not hold, so an
 * earlier year cannot name a `ukpga` Act.
 */
export const firstUkpgaYear = 1801

/**
 * The canonical Act-year rule, stated once for every `/ln/ukpga/YYYY/N` reader.
 * The year is exactly four ASCII digits and cannot precede
 * {@link firstUkpgaYear}.
 *
 * A zero-padded four-digit year such as `0204` is refused rather than rewritten:
 * it is not a year at all, so accepting it as an identity would fabricate
 * `ukpga/0204/N`, while `Number()` would silently produce the three-digit
 * `ukpga/204/N` that this grammar rejects. The free-text chapter classifier and
 * the pasted-path parser must agree about which years are canonical, so the
 * rule lives here and neither re-derives it.
 */
export function isCanonicalActYear(year: string): boolean {
  return /^[0-9]{4}$/.test(year) && Number(year) >= firstUkpgaYear
}

export function parseLegislationActPath(path: string): {
  documentIdentity: string
} | null {
  const trimmed = path.replace(/^\/ln\/?/, '').replace(/^\/+/, '')
  const parts = trimmed.split('/').filter(Boolean)
  if (parts.length !== 3) return null
  const [actType, year, number] = parts
  if (!actType || !isSupportedLegislationActType(actType)) return null
  if (!year || !isCanonicalActYear(year)) return null
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
  if (!actType || !isSupportedLegislationActType(actType)) return null
  if (!year || !isCanonicalActYear(year)) return null
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
