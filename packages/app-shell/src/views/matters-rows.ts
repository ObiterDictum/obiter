import type { MatterDocumentRecord } from '../documents'
import type { MatterRecord } from '../matters'
import type { AttentionItem } from './home-attention'
import { summariseAttention } from './home-attention'

export interface MatterOpenWork {
  flaggedFindings: number
  reviewFindings: number
  redactionDecisions: number
  failed: number
  total: number
}

export interface OpenWorkPart {
  label: string
  tone: 'danger' | 'warning' | 'info'
}

export function openWorkParts(openWork: MatterOpenWork): OpenWorkPart[] {
  const parts: OpenWorkPart[] = []
  if (openWork.flaggedFindings > 0) {
    parts.push({ label: `${openWork.flaggedFindings} flagged`, tone: 'danger' })
  }
  if (openWork.reviewFindings > 0) {
    parts.push({
      label: `${openWork.reviewFindings} need review`,
      tone: 'warning',
    })
  }
  if (openWork.redactionDecisions > 0) {
    parts.push({
      label: `${openWork.redactionDecisions} redaction ${
        openWork.redactionDecisions === 1 ? 'decision' : 'decisions'
      }`,
      tone: 'info',
    })
  }
  if (openWork.failed > 0) {
    parts.push({ label: `${openWork.failed} failed`, tone: 'danger' })
  }
  return parts
}

export interface MatterRow {
  matter: MatterRecord
  lastActivity: string
  documentCount: number | null
  openWork: MatterOpenWork | null
}

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
  flaggedFindings: 0,
  reviewFindings: 0,
  redactionDecisions: 0,
  failed: 0,
  total: 0,
}

export function openWorkFor(
  byMatter: Map<string, MatterOpenWork>,
  matterId: string,
): MatterOpenWork {
  return byMatter.get(matterId) ?? NO_OPEN_WORK
}

export function buildMatterRows(input: {
  matters: MatterRecord[]
  documentsByMatter: Map<string, MatterDocumentRecord[] | undefined>
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
  search: string
  domain: string | null
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

export function legalDomainOptions(matters: MatterRecord[]): string[] {
  const domains = new Set<string>()
  for (const matter of matters) {
    for (const domain of matter.legalDomains) domains.add(domain)
  }
  return [...domains].sort((a, b) => a.localeCompare(b))
}
