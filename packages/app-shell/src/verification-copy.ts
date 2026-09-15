import type {
  VerificationFailureCode,
  VerificationFindingState,
  VerificationFindingType,
  VerificationReviewReason,
  VerificationRunStatus,
  VerificationRunSummary,
} from '@obiter/contracts'
import type { DocumentStoryKind } from '@obiter/contracts'
import type { UnmappedReason } from './components/verification/verification-mapping'

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

/**
 * The tone for a finding outcome, defined once so the findings index, the
 * markers and the evidence panel cannot disagree.
 */
export function verificationStateTone(
  state: VerificationFindingState,
): 'success' | 'danger' | 'warning' | 'neutral' {
  switch (state) {
    case 'clear':
      return 'success'
    case 'flagged':
      return 'danger'
    case 'not_checked':
      return 'neutral'
    case 'review_required':
      return 'warning'
    default: {
      const unhandled: never = state
      return unhandled
    }
  }
}

/**
 * Why a finding is not shown beside document text. Each value states a limit of
 * the evidence, never an outcome, so a reviewer reads it as "look here" rather
 * than "nothing to see".
 */
export function verificationUnmappedLabel(reason: UnmappedReason) {
  switch (reason) {
    case 'story_not_in_document':
      return 'Not shown in the document: this finding belongs to a story the open document does not contain.'
    case 'paragraph_not_in_document':
      return 'Not shown in the document: the paragraph it names is not in the open document.'
    case 'range_not_in_document':
      return 'Not shown in the document: the recorded range does not fit the paragraph it names.'
    case 'text_changed_since_check':
      return 'Not shown in the document: the text at this location differs from the text that was checked.'
    case 'document_not_mappable':
      return 'Not shown in the document: this file type has no document model, so findings are listed here only.'
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

/**
 * The stored-version boundary, stated wherever evidence is shown. A reader must
 * never take a checked result as covering work that has not been saved.
 */
export function verificationStoredVersionNote(
  versionId: string,
  options: { unsaved: boolean; stale: boolean },
) {
  const parts = [`Checked stored version ${versionId}.`]
  if (options.stale) {
    parts.push('A newer version is stored, so this evidence is earlier.')
  }
  if (options.unsaved) {
    parts.push(
      'Unsaved edits are not part of the stored version and are not covered by this evidence.',
    )
  }
  return parts.join(' ')
}
