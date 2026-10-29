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

export function isSupportedLegislationActType(actType: string): boolean {
  return actType === 'ukpga'
}

export const firstUkpgaYear = 1801

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
