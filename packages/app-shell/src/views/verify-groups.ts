import type {
  VerificationFindingView,
  VerificationRun,
} from '@obiter/contracts'
import type { MatterRecord } from '../matters'
import type { RunDocumentIdentity } from '../verification-runs'
import { verificationSummaryCounts } from '../verification-copy'

export type VerifyDocumentGroup = {
  documentId: string
  identity: RunDocumentIdentity
  /** The newest run for this document: the state its row reports. */
  run: VerificationRun
  /** The newest completed run, whose findings are the ones listed. */
  findingsRun: VerificationRun | null
  /** True only when the run whose findings are listed still covers the stored
   * version, so an older result can never read as a check of current text. */
  coversCurrentVersion: boolean
}

export type VerifyMatterGroup = {
  matterId: string
  name: string
  reference: string
  documents: VerifyDocumentGroup[]
}

/**
 * The Verify list is grouped by matter and then by document, because that is how
 * a lawyer looks for the work: the client first, then the file. Groups follow
 * the run list's order, which is newest first, so the matter that moved most
 * recently leads.
 */
export function buildVerifyGroups(input: {
  runs: VerificationRun[]
  matters: readonly Pick<MatterRecord, 'id' | 'name' | 'clientReference'>[]
  documents: Map<string, RunDocumentIdentity>
}): VerifyMatterGroup[] {
  const matters = new Map<string, VerifyMatterGroup>()
  const documents = new Map<string, VerifyDocumentGroup>()
  for (const run of input.runs) {
    const existing = documents.get(run.documentId)
    if (existing) {
      existing.findingsRun ??= run.status === 'completed' ? run : null
      continue
    }
    const matter = input.matters.find((item) => item.id === run.matterId)
    let group = matters.get(run.matterId)
    if (!group) {
      group = {
        matterId: run.matterId,
        name: matter?.name ?? 'Matter unavailable',
        reference: matter?.clientReference?.trim() ?? '',
        documents: [],
      }
      matters.set(run.matterId, group)
    }
    const document: VerifyDocumentGroup = {
      documentId: run.documentId,
      identity: input.documents.get(run.documentId) ?? { status: 'pending' },
      run,
      findingsRun: run.status === 'completed' ? run : null,
      coversCurrentVersion: false,
    }
    // A run is stale when the document's current version is no longer the one
    // the run was bound to; the findings shown must answer for themselves.
    document.coversCurrentVersion =
      document.findingsRun != null && !document.findingsRun.stale
    group.documents.push(document)
    documents.set(run.documentId, document)
  }
  return [...matters.values()]
}

export type VerifyFilter = 'all' | 'flagged' | 'review' | 'unchecked' | 'match'

const verifyFilters: readonly VerifyFilter[] = [
  'all',
  'flagged',
  'review',
  'unchecked',
  'match',
]

export function isVerifyFilter(value: string | null): value is VerifyFilter {
  return value !== null && verifyFilters.some((filter) => filter === value)
}

/**
 * A state filter shows open work of that state, so a finding a person has
 * already dismissed is listed only under All. Its outcome is unchanged: it keeps
 * its flagged or review-required state, and the counts keep it apart.
 */
export function findingMatchesFilter(
  finding: VerificationFindingView,
  filter: VerifyFilter,
) {
  if (filter === 'all') return true
  if (finding.dismissal) return false
  switch (filter) {
    case 'flagged':
      return finding.state === 'flagged'
    case 'review':
      return finding.state === 'review_required'
    case 'unchecked':
      return finding.state === 'not_checked'
    case 'match':
      return finding.state === 'clear'
    default: {
      const unhandled: never = filter
      return unhandled
    }
  }
}

/** Whether a document group has anything the filter would show, read from the
 * run summary so the answer is known before any findings are fetched. */
export function groupMatchesFilter(
  group: VerifyDocumentGroup,
  filter: VerifyFilter,
) {
  if (filter === 'all') return true
  const run = group.findingsRun
  if (!run) return false
  const counts = verificationSummaryCounts(run.summary)
  switch (filter) {
    case 'flagged':
      return counts.flagged > 0
    case 'review':
      return counts.needsReview > 0
    case 'unchecked':
      return counts.notChecked > 0
    case 'match':
      return counts.matched > 0
    default: {
      const unhandled: never = filter
      return unhandled
    }
  }
}

/** Filter counts across every shown document's results, from the run summaries
 * the API computes over every finding rather than the pages loaded so far. */
export function verifyFilterCounts(groups: VerifyMatterGroup[]) {
  const counts = {
    all: 0,
    flagged: 0,
    review: 0,
    unchecked: 0,
    match: 0,
  } satisfies Record<VerifyFilter, number>
  for (const matter of groups) {
    for (const document of matter.documents) {
      if (!document.findingsRun) continue
      const summary = verificationSummaryCounts(document.findingsRun.summary)
      counts.all += summary.total
      counts.flagged += summary.flagged
      counts.review += summary.needsReview
      counts.unchecked += summary.notChecked
      counts.match += summary.matched
    }
  }
  return counts
}
