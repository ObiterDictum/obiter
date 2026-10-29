import {
  createCanonicalActPath,
  createCanonicalProvisionPath,
} from '@obiter/contracts'
import {
  getLegislationActProvisionsSnapshot,
  getLegislationDocument,
  provisionTextServable,
  type StoredLegislationActProvision,
} from './legislation-store'
import {
  withStoredTimeout,
  type LegislationServeDeps,
} from './legislation-serve'
import type { LegislationProvisionKind } from './legislation-kind'
import { isContainerKind } from './legislation-kind'

interface LegislationActContentsNode {
  label: string
  labelPath: string
  href: string
  extent: string
  withheld: boolean
  kind: LegislationProvisionKind
  text?: string
  heading?: string
  children: LegislationActContentsNode[]
}

interface LegislationActPage {
  act: {
    identity: string
    title: string
    year: number
    number: number
    chapter: string
    extent: string
    officialUrl: string
    sourceUrl: string
    acquiredAt?: string
    canonicalUrl: string
    totalCount: number
    withheldCount: number
    contents: LegislationActContentsNode[]
  }
}

type LegislationActPageResult =
  | { status: 'ok'; page: LegislationActPage }
  | { status: 'not_found' }
  | { status: 'unavailable' }

function rowWithheld(row: StoredLegislationActProvision): boolean {
  if (isContainerKind(row.kind)) return false
  return !provisionTextServable(row.hasUnappliedEffects, row.effectsCheckedAt)
}

interface LegislationActContentsTree {
  roots: LegislationActContentsNode[]
  totalCount: number
  withheldCount: number
}

function buildContentsTree(
  documentIdentity: string,
  rows: StoredLegislationActProvision[],
): LegislationActContentsTree {
  const nodes = new Map<string, LegislationActContentsNode>()
  for (const row of rows) {
    nodes.set(row.labelPath, {
      label: row.label,
      labelPath: row.labelPath,
      href: createCanonicalProvisionPath(documentIdentity, row.labelPath),
      extent: row.extent,
      withheld: rowWithheld(row),
      kind: row.kind,
      text: isContainerKind(row.kind) ? row.text : undefined,
      ...(isContainerKind(row.kind) || !row.heading
        ? {}
        : { heading: row.heading }),
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

export async function resolveLegislationActPage(
  pool: LegislationServeDeps['pool'],
  identity: string,
): Promise<LegislationActPageResult> {
  let document
  let snapshot
  try {
    ;[document, snapshot] = await withStoredTimeout(
      Promise.all([
        getLegislationDocument(pool, identity),
        getLegislationActProvisionsSnapshot(pool, identity),
      ]),
    )
  } catch {
    return { status: 'unavailable' }
  }
  if (!document) return { status: 'not_found' }
  if (!snapshot.classified) return { status: 'unavailable' }
  const officialUrl = `https://www.legislation.gov.uk/${document.identity}`
  const { roots, totalCount, withheldCount } = buildContentsTree(
    document.identity,
    snapshot.rows,
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
        ...(document.acquiredAt ? { acquiredAt: document.acquiredAt } : {}),
        canonicalUrl: createCanonicalActPath(document.identity),
        totalCount,
        withheldCount,
        contents: roots,
      },
    },
  }
}
