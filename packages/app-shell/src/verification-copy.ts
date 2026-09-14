import type {
  VerificationFailureCode,
  VerificationFindingState,
  VerificationFindingType,
  VerificationReviewReason,
  VerificationRunStatus,
  VerificationRunSummary,
} from '@obiter/contracts'
import type { DocumentStoryKind } from '@obiter/contracts'

export function verificationStoryLabel(kind: DocumentStoryKind | undefined) {
  switch (kind) {
    case 'document':
      return 'Main document'
    case 'footnotes':
      return 'Footnote'
    case 'endnotes':
      return 'Endnote'
    case 'header':
      return 'Header'
    case 'footer':
      return 'Footer'
    case 'comments':
      return 'Comment'
    default:
      return null
  }
}

/**
 * The finding outcome, kept separate from run completion so a completed run
 * with a proven mismatch is not presented as a plain success. Flagged is the
 * most serious outcome and is never less prominent than review-required.
 */
export function verificationOutcomeTone(
  summary: VerificationRunSummary,
): 'danger' | 'warning' | 'success' {
  if (summary.flaggedCount > 0) return 'danger'
  if (summary.reviewRequiredCount > 0) return 'warning'
  return 'success'
}

export function verificationOutcomeLabel(summary: VerificationRunSummary) {
  if (summary.flaggedCount > 0) {
    return `Flagged findings (${summary.flaggedCount})`
  }
  if (summary.reviewRequiredCount > 0) {
    return `Review required (${summary.reviewRequiredCount})`
  }
  return 'No findings need attention'
}

/** The screen-reader wording for the same outcome, so the result is never
 * carried by colour alone. */
export function verificationOutcomeAnnouncement(
  summary: VerificationRunSummary,
) {
  if (summary.flaggedCount > 0) {
    return 'Attention required: flagged findings were found.'
  }
  if (summary.reviewRequiredCount > 0) {
    return 'Some findings require review.'
  }
  return 'No findings require attention.'
}

export function verificationTypeLabel(type: VerificationFindingType) {
  switch (type) {
    case 'authority_existence':
      return 'Authority existence'
    case 'citation_resolution':
      return 'Citation resolution'
    case 'quote_fidelity':
      return 'Quote fidelity'
    default: {
      const unhandled: never = type
      return unhandled
    }
  }
}

export function verificationStateLabel(state: VerificationFindingState) {
  switch (state) {
    case 'clear':
      return 'Clear'
    case 'flagged':
      return 'Flagged'
    case 'not_checked':
      return 'Not checked'
    case 'review_required':
      return 'Needs review'
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

export function verificationReasonLabel(reason: VerificationReviewReason) {
  switch (reason) {
    case 'citation_ambiguous':
      return 'This text could be associated with more than one authority, so no single one was chosen.'
    case 'citation_unresolved':
      return 'The citation did not resolve to a stored authority.'
    case 'authority_not_held':
      return 'The stored sources do not hold this authority.'
    case 'evidence_unavailable':
      return 'Source evidence is not available.'
    case 'check_inconclusive':
      return 'The check could not reach a conclusion.'
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

export function verificationRunStatusLabel(status: VerificationRunStatus) {
  switch (status) {
    case 'queued':
      return 'Queued'
    case 'running':
      return 'Running'
    case 'completed':
      return 'Completed'
    case 'failed':
      return 'Failed'
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

export function verificationFailureLabel(code: VerificationFailureCode) {
  switch (code) {
    case 'model_unavailable':
      return 'The stored document could not be read for verification.'
    case 'version_not_ready':
      return 'This document version is not ready to verify.'
    case 'execution_failed':
      return 'Verification could not finish. No successful result was recorded.'
    case 'interrupted':
      return 'Verification was interrupted before it finished. Start a new run to check this version.'
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}
