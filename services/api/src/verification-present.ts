import {
  createEvidenceReferenceId,
  requiresReview,
  type EvidenceReference,
  type NormalizedCitation,
  type VerificationFinding,
} from '@obiter/verification-core'
import type {
  VerificationEvidenceView,
  VerificationFindingView,
  VerificationRun,
  VerificationRunSummary,
} from '@obiter/contracts'
import type { VerificationFailureCode } from '@obiter/contracts'

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
  document_current_version_id: string | null
}

function iso(value: Date | string | null) {
  if (value == null) return null
  return value instanceof Date ? value.toISOString() : value
}

function count(value: string | number | null) {
  return Number(value ?? 0)
}

export function runSummary(row: VerificationRunRow): VerificationRunSummary {
  return {
    findingCount: count(row.finding_count),
    flaggedCount: count(row.flagged_count),
    reviewRequiredCount: count(row.review_required_count),
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
      return 'Unresolved citation'
    case 'not_checked':
      return 'Citation not checked'
    default: {
      const unhandled: never = citation
      return unhandled
    }
  }
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

export function toPublicFinding(
  finding: VerificationFinding,
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
    requiresReview: requiresReview(finding.status),
    explanation: finding.explanation,
    excerpt: finding.citation.rawText,
    location: finding.citation.location,
    authorityLabel: authorityLabel(finding.normalizedCitation),
    evidence: finding.evidence.map(
      (reference): VerificationEvidenceView => ({
        id: createEvidenceReferenceId(reference),
        sourceId: reference.sourceId,
        label: evidenceLabel(reference),
      }),
    ),
  }
}
