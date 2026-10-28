import type { MatterDocumentRecord } from '../documents'
import type { MatterRecord } from '../matters'
import type { AttentionItem } from './home-attention'
import { summariseAttention } from './home-attention'

/**
 * The matters list's rows, derived once and kept free of React so the table, the
 * preview and the tests read the same facts. Everything here comes from reads
 * the shell already makes: the matters list, each matter's documents, and the
 * same attention items Home ranks.
 */

export interface MatterOpenWork {
  items: AttentionItem[]
  /**
   * Unresolved findings, not queue rows: one Verify run can carry several, and
   * the sidebar counts them the same way. A queue row is one decision.
   */
  flaggedFindings: number
  reviewFindings: number
  redactionDecisions: number
  failed: number
  /** Rows this matter contributes to Home's queue. */
  total: number
}

export interface MatterRow {
  matter: MatterRecord
  /**
   * The newest matter change or document version. A matter's own `updatedAt`
   * does not move when someone uploads or edits a document in it.
   */
  lastActivity: string
  /** Null while that matter's documents are unread. */
  documentCount: number | null
  /** Null until the runs behind the attention items have loaded. */
  openWork: MatterOpenWork | null
}

/**
 * Group the queue's items by matter, so "open work" means exactly what Home and
 * the sidebar mean by it: a Verify finding nobody resolved, a redaction run with
 * an undecided span, or a run that failed.
 */
export function openWorkByMatter(
  items: AttentionItem[],
): Map<string, MatterOpenWork> {
  const grouped = new Map<string, AttentionItem[]>()
  for (const item of items) {
    if (!item.matterId) continue
    const forMatter = grouped.get(item.matterId)
    if (forMatter) forMatter.push(item)
    else grouped.set(item.matterId, [item])
  }
  const byMatter = new Map<string, MatterOpenWork>()
  for (const [matterId, forMatter] of grouped) {
    const summary = summariseAttention(forMatter)
    let flaggedFindings = 0
    let reviewFindings = 0
    for (const item of forMatter) {
      if (item.kind === 'verify_flagged' || item.kind === 'verify_review') {
        flaggedFindings += item.flaggedCount
        reviewFindings += item.reviewRequiredCount
      }
    }
    byMatter.set(matterId, {
      items: forMatter,
      flaggedFindings,
      reviewFindings,
      redactionDecisions: summary.redactDecisions,
      failed: summary.failed,
      total: summary.total,
    })
  }
  return byMatter
}

const NO_OPEN_WORK: MatterOpenWork = {
  items: [],
  flaggedFindings: 0,
  reviewFindings: 0,
  redactionDecisions: 0,
  failed: 0,
  total: 0,
}

/** A matter's open work, or none when it has no queued item. */
export function openWorkFor(
  byMatter: Map<string, MatterOpenWork>,
  matterId: string,
): MatterOpenWork {
  return byMatter.get(matterId) ?? NO_OPEN_WORK
}

export function buildMatterRows(input: {
  matters: MatterRecord[]
  /** matterId → that matter's documents, absent until they are read. */
  documentsByMatter: Map<string, MatterDocumentRecord[] | undefined>
  /** Null while the runs behind the queue are still loading. */
  openWork: Map<string, MatterOpenWork> | null
}): MatterRow[] {
  return input.matters
    .map((matter) => {
      const documents = input.documentsByMatter.get(matter.id)
      return {
        matter,
        lastActivity: lastActivityOf(matter, documents),
        documentCount: documents?.length ?? null,
        openWork:
          input.openWork === null
            ? null
            : openWorkFor(input.openWork, matter.id),
      }
    })
    .sort((a, b) => b.lastActivity.localeCompare(a.lastActivity))
}

/** A matter with no readable documents falls back to its own last change. */
export function lastActivityOf(
  matter: MatterRecord,
  documents: MatterDocumentRecord[] | undefined,
): string {
  let newest = matter.updatedAt
  for (const document of documents ?? []) {
    const version = document.currentVersion
    if (!version) continue
    if (version.updatedAt > newest) newest = version.updatedAt
  }
  return newest
}

export interface MatterFilter {
  /** Matches the matter name, reference, jurisdiction or legal domain. */
  search: string
  /** A legal domain exactly as the API returns it, or null for every matter. */
  domain: string | null
  /** Only matters with open work. */
  needsAttention: boolean
}

export function filterMatterRows(
  rows: MatterRow[],
  filter: MatterFilter,
): MatterRow[] {
  const search = filter.search.trim().toLowerCase()
  return rows.filter((row) => {
    const matter = row.matter
    if (filter.domain && !matter.legalDomains.includes(filter.domain)) {
      return false
    }
    if (filter.needsAttention && (row.openWork?.total ?? 0) === 0) return false
    if (!search) return true
    return [
      matter.name,
      matter.clientReference,
      matter.primaryJurisdiction,
      ...matter.legalDomains,
    ]
      .join('\n')
      .toLowerCase()
      .includes(search)
  })
}

/** The filter chips: the domains the loaded matters actually use. */
export function legalDomainOptions(matters: MatterRecord[]): string[] {
  const domains = new Set<string>()
  for (const matter of matters) {
    for (const domain of matter.legalDomains) domains.add(domain)
  }
  return [...domains].sort((a, b) => a.localeCompare(b))
}
