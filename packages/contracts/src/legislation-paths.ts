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

const regnalReign = /^[A-Z][a-z]+[0-9]*(?:and[0-9]+[A-Z][a-z]+[0-9]*)*$/
const regnalSession = /^[0-9]+(?:-[0-9]+)*$/

function splitDocumentIdentity(
  parts: string[],
): { documentIdentity: string; rest: string[] } | null {
  const [actType, first, second, third] = parts
  if (actType !== 'ukpga' || !first || !second) return null
  if (isCanonicalActYear(first)) {
    if (!/^\d+$/.test(second)) return null
    return {
      documentIdentity: `${actType}/${first}/${second}`,
      rest: parts.slice(3),
    }
  }
  if (!regnalReign.test(first) || !regnalSession.test(second)) return null
  if (!third || !/^\d+$/.test(third)) return null
  return {
    documentIdentity: `${actType}/${first}/${second}/${third}`,
    rest: parts.slice(4),
  }
}

function pathParts(path: string) {
  return path
    .replace(/^\/ln\/?/, '')
    .replace(/^\/+/, '')
    .split('/')
    .filter(Boolean)
}

export function parseLegislationActPath(path: string): {
  documentIdentity: string
} | null {
  const split = splitDocumentIdentity(pathParts(path))
  if (!split || split.rest.length > 0) return null
  return { documentIdentity: split.documentIdentity }
}

export function parseLegislationProvisionPath(path: string): {
  documentIdentity: string
  labelPath: string
  provisionId: string
} | null {
  const split = splitDocumentIdentity(pathParts(path))
  if (!split || split.rest.length === 0) return null
  const labelPath = split.rest.join('/')
  return {
    documentIdentity: split.documentIdentity,
    labelPath,
    provisionId: `${split.documentIdentity}/${labelPath}`,
  }
}
