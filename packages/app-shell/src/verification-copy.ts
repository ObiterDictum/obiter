import type {
  VerificationFailureCode,
  VerificationFindingState,
  VerificationFindingType,
  VerificationReviewReason,
  VerificationRunStatus,
} from '@obiter/contracts'

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
      return 'The citation matches more than one stored authority.'
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
    default: {
      const unhandled: never = code
      return unhandled
    }
  }
}
