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
  run: VerificationRun
  findingsRun: VerificationRun | null
  coversCurrentVersion: boolean
}

export type VerifyMatterGroup = {
  matterId: string
  name: string
  reference: string
  documents: VerifyDocumentGroup[]
}

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

const stateOrder = {
  flagged: 0,
  review_required: 1,
  not_checked: 2,
  clear: 3,
} satisfies Record<VerificationFindingView['state'], number>

export function sortFindings(
  findings: readonly VerificationFindingView[],
): VerificationFindingView[] {
  return [...findings].sort(
    (a, b) =>
      stateOrder[a.state] - stateOrder[b.state] ||
      a.location.start - b.location.start,
  )
}

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
