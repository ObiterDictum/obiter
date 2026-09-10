import {
  createCanonicalActPath,
  createCanonicalProvisionPath,
} from '@obiter/contracts'
import {
  getLegislationDocument,
  legislationActProvisionsClassified,
  listLegislationActProvisions,
  provisionTextServable,
  type StoredLegislationActProvision,
} from './legislation-store'
import {
  withStoredTimeout,
  type LegislationServeDeps,
} from './legislation-serve'
import type { LegislationProvisionKind } from './legislation-kind'
import { isContainerKind } from './legislation-kind'

export interface LegislationActContentsNode {
  label: string
  labelPath: string
  href: string
  extent: string
  withheld: boolean
  kind: LegislationProvisionKind
  /** Heading text for container rows; never set for provision rows (the
   * Act page never serves provision body text). */
  text?: string
  children: LegislationActContentsNode[]
}

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
    /** P1 content rows: sections plus schedule paragraphs, the withheld-
     * eligible entries. Containers (Part, Chapter, Schedule, crossheading)
     * are headings and never withheld, so they are excluded from both
     * counts. */
    totalCount: number
    withheldCount: number
    /** Tree roots in document order. */
    contents: LegislationActContentsNode[]
  }
}

export type LegislationActPageResult =
  | { status: 'ok'; page: LegislationActPage }
  | { status: 'not_found' }
  | { status: 'unavailable' }

/** Fail-closed per-row withheld state for the contents tree: a P1 row
 * withholds unless a successful effects check (non-null timestamp) found
 * no unapplied effects. Container rows are headings: never flagged by the
 * effects pass, never withheld. */
function rowWithheld(row: StoredLegislationActProvision): boolean {
  if (isContainerKind(row.kind)) return false
  return !provisionTextServable(row.hasUnappliedEffects, row.effectsCheckedAt)
}

/**
 * Assembles the contents tree from rows already ordered by doc_order.
 * Children attach through the stored parent pointers (CLML nesting), never
 * through label-path prefixes. DocOrder order preserved because children
 * are appended in row order and rows arrive in doc order.
 */
function buildContentsTree(
  documentIdentity: string,
  rows: StoredLegislationActProvision[],
): {
  roots: LegislationActContentsNode[]
  totalCount: number
  withheldCount: number
} {
  const nodes = new Map<string, LegislationActContentsNode>()
  for (const row of rows) {
    nodes.set(row.labelPath, {
      label: row.label,
      labelPath: row.labelPath,
      href: createCanonicalProvisionPath(documentIdentity, row.labelPath),
      extent: row.extent,
      // Fail-closed, matching the provision-page gate: only an explicit
      // false carrying a check timestamp reads as servable. Containers are
      // never flagged and never withheld, so headings stay visible.
      withheld: rowWithheld(row),
      kind: row.kind,
      // Container rows carry their heading text so the Act page can render
      // "Part 2 — Equality: key concepts". Provision body text is never
      // served here (the provision page carries that gate).
      text: isContainerKind(row.kind) ? row.text : undefined,
      children: [],
    })
  }
  const roots: LegislationActContentsNode[] = []
  for (const row of rows) {
    const node = nodes.get(row.labelPath)!
    const parent =
      row.parentLabelPath !== null ? nodes.get(row.parentLabelPath) : undefined
    if (parent) parent.children.push(node)
    else roots.push(node)
  }
  const contentRowCount = rows.reduce(
    (sum, row) => (row.kind === 'P1' ? sum + 1 : sum),
    0,
  )
  const withheldCount = rows.reduce(
    (sum, row) => (row.kind === 'P1' && rowWithheld(row) ? sum + 1 : sum),
    0,
  )
  return { roots, totalCount: contentRowCount, withheldCount }
}

/**
 * Whole-Act page. Contents arrive in document order from the store and the
 * tree is assembled without any sort, so inserted sections (s. 13A between
 * ss. 13 and 14) keep their enacted position. Withheld entries stay listed
 * and linked (the provision page carries the gate); only the text is
 * absent, and text is never served here at all. Fail-closed matches the
 * provision page: current text reads as servable only after a successful
 * effects check; an unchecked row still lists and links, minus text.
 */
export async function resolveLegislationActPage(
  pool: LegislationServeDeps['pool'],
  identity: string,
): Promise<LegislationActPageResult> {
  let document
  let provisions
  let classified
  try {
    ;[document, provisions, classified] = await withStoredTimeout(
      Promise.all([
        getLegislationDocument(pool, identity),
        listLegislationActProvisions(pool, identity),
        legislationActProvisionsClassified(pool, identity),
      ]),
    )
  } catch {
    return { status: 'unavailable' }
  }
  if (!document) return { status: 'not_found' }
  // Rows written before migration 0022 carry kind = NULL until a
  // --force-reparse rewrites them; listing them here would render their
  // P2..P5 content as flat top-level provisions. Fail closed: the whole
  // Act page stays unavailable until every row of the document is
  // classified, never a silently mis-classified tree.
  if (!classified) return { status: 'unavailable' }
  const officialUrl = `https://www.legislation.gov.uk/${document.identity}`
  const { roots, totalCount, withheldCount } = buildContentsTree(
    document.identity,
    provisions,
  )
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
        totalCount,
        withheldCount,
        contents: roots,
      },
    },
  }
}
