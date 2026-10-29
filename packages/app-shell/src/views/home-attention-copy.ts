import type { VerificationFindingView } from '@obiter/contracts'
import {
  verificationAuthority,
  verificationFailureLabel,
} from '../verification-copy'
import { formatDateTime } from '../format'
import type { AttentionItem, AttentionSummary } from './home-attention'

export function attentionSummaryText(summary: AttentionSummary): string {
  if (summary.total === 0) return 'Nothing needs your attention right now.'
  const parts: string[] = []
  if (summary.flagged > 0) {
    parts.push(count(summary.flagged, 'legal-accuracy risk'))
  }
  if (summary.redactDecisions > 0) {
    parts.push(count(summary.redactDecisions, 'redaction decision'))
  }
  if (summary.reviews > 0) {
    parts.push(
      count(summary.reviews, 'citation to review', 'citations to review'),
    )
  }
  if (summary.failed > 0) parts.push(count(summary.failed, 'failed run'))
  const noun = summary.total === 1 ? 'item' : 'items'
  const verb = summary.total === 1 ? 'needs' : 'need'
  return `${summary.total} ${noun} ${verb} your attention: ${list(parts)}.`
}

function count(value: number, singular: string, plural = `${singular}s`) {
  return `${value} ${value === 1 ? singular : plural}`
}

function list(parts: string[]) {
  if (parts.length <= 1) return parts.join('')
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
}

export function attentionReason(item: AttentionItem): string {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
      return 'Accuracy risk'
    case 'verify_review':
      return 'Needs review'
    case 'redact_decision':
      return item.undecidedCount === null
        ? 'Awaiting a decision'
        : `Awaiting a decision · ${count(item.undecidedCount, 'detected span')}`
    case 'verify_failed':
    case 'redact_failed':
      return 'Run failed'
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

export function attentionTitle(item: AttentionItem): string {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
      return item.flaggedCount === 1
        ? 'Flagged finding'
        : `${item.flaggedCount} flagged findings`
    case 'verify_review':
      return item.reviewRequiredCount === 1
        ? 'Finding needs review'
        : `${item.reviewRequiredCount} findings need review`
    case 'redact_decision':
      return 'Redaction waiting for a decision'
    case 'verify_failed':
      return 'Verify run did not finish'
    case 'redact_failed':
      return 'Redaction run did not finish'
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

export interface AttentionStatus {
  label: string
  tone: 'info' | 'warning' | 'danger'
}

export function attentionStatus(item: AttentionItem): AttentionStatus {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
      return { label: 'Flagged', tone: 'danger' }
    case 'verify_review':
      return { label: 'Needs review', tone: 'warning' }
    case 'redact_decision':
      return { label: 'In review', tone: 'info' }
    case 'verify_failed':
    case 'redact_failed':
      return { label: 'Failed', tone: 'danger' }
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

export function attentionExplanation(
  item: AttentionItem,
  finding?: VerificationFindingView | null,
): string {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
    case 'verify_review': {
      const remaining = item.flaggedCount + item.reviewRequiredCount
      if (finding) {
        const rest = remaining > 1 ? ` ${remaining - 1} more in this run.` : ''
        return `${verificationAuthority(finding)}: ${finding.explanation}${rest}`
      }
      const parts: string[] = []
      if (item.flaggedCount > 0) parts.push(`${item.flaggedCount} flagged`)
      if (item.reviewRequiredCount > 0)
        parts.push(`${item.reviewRequiredCount} to review`)
      return `${parts.join(' and ')} in this run. Open the document to see each finding.`
    }
    case 'redact_decision': {
      if (item.undecidedCount === null) {
        return 'This run is waiting for a decision before it can be finalised.'
      }
      const spans =
        item.totalSpans === null
          ? count(item.undecidedCount, 'detected span')
          : `${item.undecidedCount} of ${item.totalSpans} detected spans`
      return `${spans} still need a decision before the run can be finalised.`
    }
    case 'verify_failed':
      return item.failureCode
        ? verificationFailureLabel(item.failureCode)
        : 'The run did not finish, so this version has not been checked.'
    case 'redact_failed':
      return 'The run stopped before it was finalised. No output was produced.'
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

export function attentionMeta(item: AttentionItem): string {
  const kind = item.kind
  switch (kind) {
    case 'verify_flagged':
    case 'verify_review':
    case 'verify_failed':
      return `Verify · ${formatDateTime(item.waitingSince)}`
    case 'redact_decision':
      return item.redactedCount === null || item.keptCount === null
        ? `Redact · ${formatDateTime(item.waitingSince)}`
        : `Redact · ${item.redactedCount} redacted · ${item.keptCount} kept`
    case 'redact_failed':
      return `Redact · ${formatDateTime(item.waitingSince)}`
    default: {
      const unhandled: never = kind
      return unhandled
    }
  }
}

export function topUnresolvedFinding(
  findings: VerificationFindingView[],
): VerificationFindingView | null {
  return (
    findings.find((finding) => finding.state === 'flagged') ??
    findings.find((finding) => finding.state === 'review_required') ??
    null
  )
}
