import { createCanonicalCasePath } from '@obiter/contracts'
import {
  createEvidenceReferenceId,
  requiresReview,
  type EvidenceReference,
  type NormalizedCitation,
  type VerificationFinding,
} from '@obiter/verification-core'
import type {
  VerificationEvidenceSource,
  VerificationEvidenceView,
  VerificationFindingDismissal,
  VerificationFindingView,
  VerificationRun,
  VerificationRunSummary,
} from '@obiter/contracts'
import {
  findingSourceKey,
  type StoredFindingSource,
} from './verification-finding-sources'
import type { VerificationFailureCode } from '@obiter/contracts'
import type { DocumentStoryKind } from '@obiter/contracts'

const storyKinds: DocumentStoryKind[] = [
  'document',
  'header',
  'footer',
  'footnotes',
  'endnotes',
  'comments',
]

/** The domain location carries the story as an opaque string; the view's
 * contract types it. Narrow rather than assert, so an unknown story is dropped
 * instead of reaching the response untyped. */
function asStoryKind(value: string | undefined) {
  return storyKinds.find((kind) => kind === value)
}

export type VerificationRunRow = {
  id: string
  organisation_id: string
  matter_id: string
  document_id: string
  document_version_id: string
  status: VerificationRun['status']
  failure_code: VerificationFailureCode | null
  created_by: string
  created_at: Date | string
  started_at: Date | string | null
  completed_at: Date | string | null
  finding_count: string | number | null
  flagged_count: string | number | null
  review_required_count: string | number | null
  not_checked_count: string | number | null
  dismissed_count: string | number | null
  document_current_version_id: string | null
}

function iso(value: Date | string | null) {
  if (value == null) return null
  return value instanceof Date ? value.toISOString() : value
}

function count(value: string | number | null) {
  return Number(value ?? 0)
}

function runSummary(row: VerificationRunRow): VerificationRunSummary {
  return {
    findingCount: count(row.finding_count),
    flaggedCount: count(row.flagged_count),
    reviewRequiredCount: count(row.review_required_count),
    notCheckedCount: count(row.not_checked_count),
    dismissedCount: count(row.dismissed_count),
  }
}

export function toPublicRun(row: VerificationRunRow): VerificationRun {
  const documentCurrentVersionId = row.document_current_version_id
  return {
    id: row.id,
    organisationId: row.organisation_id,
    matterId: row.matter_id,
    documentId: row.document_id,
    documentVersionId: row.document_version_id,
    status: row.status,
    failureCode: row.failure_code,
    createdBy: row.created_by,
    createdAt: iso(row.created_at) ?? new Date(0).toISOString(),
    startedAt: iso(row.started_at),
    completedAt: iso(row.completed_at),
    summary: runSummary(row),
    documentCurrentVersionId,
    stale:
      documentCurrentVersionId != null &&
      documentCurrentVersionId !== row.document_version_id,
  }
}

function authorityLabel(citation: NormalizedCitation) {
  switch (citation.kind) {
    case 'case_law':
      return citation.neutralCitation
    case 'legislation':
      return citation.labelPath
        ? `${citation.documentIdentity} ${citation.labelPath}`
        : citation.documentIdentity
    case 'unresolved':
      return 'Unmatched citation'
    case 'not_checked':
      return 'Citation not checked'
    default: {
      const unhandled: never = citation
      return unhandled
    }
  }
}

/**
 * The case name the stored judgment carries, looked up through the finding's
 * own judgment evidence. Nothing is derived from the citation itself: a
 * citation that names a source the store has no title for yields null and the
 * UI shows the citation alone.
 */
function authorityName(
  finding: VerificationFinding,
  sources: Map<string, StoredFindingSource> | undefined,
) {
  const references = finding.evidence.filter(
    (reference) => reference.sourceType === 'judgment',
  )
  for (const reference of references) {
    const stored = sources?.get(findingSourceKey(reference))
    if (stored?.title) return stored.title
  }
  return null
}

function evidenceLabel(reference: EvidenceReference): string {
  if (reference.granularity === 'document') {
    return reference.sourceType === 'judgment'
      ? `Judgment ${reference.sourceId}`
      : `Act ${reference.sourceId}`
  }
  if (reference.sourceType === 'judgment') {
    const printed =
      reference.paragraphNumber == null
        ? `position ${reference.ordinal}`
        : `paragraph ${reference.paragraphNumber}`
    return `Judgment ${reference.sourceId}, ${printed}`
  }
  return `Provision ${reference.sourceId} ${reference.labelPath}`
}

/**
 * The evidence's own location. A judgment's stage 7 page takes a paragraph
 * anchor; a provision's page is its canonical `/ln/` path. `pinpoint` is stated
 * only when the evidence names one, and a whole-document reference names none.
 */
function evidenceSource(
  reference: EvidenceReference,
  sources: Map<string, StoredFindingSource> | undefined,
): VerificationEvidenceSource {
  const stored = sources?.get(findingSourceKey(reference))
  if (reference.sourceType !== 'judgment') {
    return {
      url: stored?.url ?? null,
      canonicalUrl:
        reference.granularity === 'fragment'
          ? `/ln/${reference.sourceId}/${reference.labelPath}`
          : `/ln/${reference.sourceId}`,
      pinpoint:
        reference.granularity === 'fragment'
          ? reference.labelPath.replaceAll('/', ' ')
          : null,
      anchor: null,
    }
  }
  const fragment = reference.granularity === 'fragment'
  return {
    url: stored?.url ?? null,
    canonicalUrl: stored
      ? createCanonicalCasePath({
          id: reference.sourceId,
          title: stored.title ?? reference.sourceId,
          neutralCitation: stored.neutralCitation,
        })
      : null,
    pinpoint: fragment
      ? reference.paragraphNumber == null
        ? `judgment position ${String(reference.ordinal)}`
        : `judgment [${String(reference.paragraphNumber)}]`
      : null,
    // Stage 7 anchors a paragraph by the number the court printed, so a
    // judgment with no printed number links the page rather than guessing one.
    anchor:
      fragment && reference.paragraphNumber != null
        ? `para-${String(reference.paragraphNumber)}`
        : null,
  }
}

export type FindingViewContext = {
  dismissal?: VerificationFindingDismissal | null
  sources?: Map<string, StoredFindingSource>
}

export function toPublicFinding(
  finding: VerificationFinding,
  context: FindingViewContext = {},
): VerificationFindingView {
  const reviewReason =
    finding.status.state === 'review_required' ? finding.status.reason : null
  return {
    id: finding.id,
    type: finding.type,
    state: finding.status.state,
    reviewReason,
    severity: finding.severity,
    confidence: finding.confidence,
    dismissal: context.dismissal ?? null,
    requiresReview: requiresReview(finding.status),
    explanation: finding.explanation,
    excerpt: finding.citation.rawText,
    location: {
      paragraphId: finding.citation.location.paragraphId,
      storyKind: asStoryKind(finding.citation.location.storyKind),
      storyPartName: finding.citation.location.storyPartName,
      start: finding.citation.location.start,
      end: finding.citation.location.end,
    },
    authorityLabel: authorityLabel(finding.normalizedCitation),
    authorityName: authorityName(finding, context.sources),
    evidence: finding.evidence.map((reference): VerificationEvidenceView => ({
      id: createEvidenceReferenceId(reference),
      sourceId: reference.sourceId,
      label: evidenceLabel(reference),
      source: evidenceSource(reference, context.sources),
    })),
  }
}
