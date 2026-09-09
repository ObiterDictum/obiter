import {
  createCanonicalActPath,
  createCanonicalProvisionPath,
} from '@obiter/contracts'
import {
  getLegislationDocument,
  listLegislationActProvisions,
} from './legislation-store'
import {
  withStoredTimeout,
  type LegislationServeDeps,
} from './legislation-serve'

export interface LegislationActPage {
  act: {
    identity: string
    title: string
    year: number
    number: number
    chapter: string
    extent: string
    officialUrl: string
    sourceUrl: string
    canonicalUrl: string
    totalCount: number
    withheldCount: number
    contents: Array<{
      label: string
      labelPath: string
      href: string
      extent: string
      withheld: boolean
    }>
  }
}

export type LegislationActPageResult =
  | { status: 'ok'; page: LegislationActPage }
  | { status: 'not_found' }
  | { status: 'unavailable' }

/**
 * Whole-Act page. Contents arrive in document order from the store; the
 * resolver never re-sorts, so inserted sections (s. 13A between ss. 13
 * and 14) keep their enacted position. Withheld entries stay listed and
 * linked (the provision page carries the gate); only the text is absent,
 * and text is never served here at all. Fail-closed matches the provision
 * page: only an explicit false reads as servable.
 */
export async function resolveLegislationActPage(
  pool: LegislationServeDeps['pool'],
  identity: string,
): Promise<LegislationActPageResult> {
  let document
  let provisions
  try {
    ;[document, provisions] = await withStoredTimeout(
      Promise.all([
        getLegislationDocument(pool, identity),
        listLegislationActProvisions(pool, identity),
      ]),
    )
  } catch {
    return { status: 'unavailable' }
  }
  if (!document) return { status: 'not_found' }
  const officialUrl = `https://www.legislation.gov.uk/${document.identity}`
  const contents = provisions.map((provision) => ({
    label: provision.label,
    labelPath: provision.labelPath,
    href: createCanonicalProvisionPath(document.identity, provision.labelPath),
    extent: provision.extent,
    withheld: provision.hasUnappliedEffects !== false,
  }))
  return {
    status: 'ok',
    page: {
      act: {
        identity: document.identity,
        title: document.title,
        year: document.year,
        number: document.number,
        chapter: `${document.year} c. ${document.number}`,
        extent: document.extent,
        officialUrl,
        sourceUrl: document.sourceUrl,
        canonicalUrl: createCanonicalActPath(document.identity),
        totalCount: contents.length,
        withheldCount: contents.filter((entry) => entry.withheld).length,
        contents,
      },
    },
  }
}
