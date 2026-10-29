import type {
  CitationInput,
  CitationUnresolvedReason,
  NormalizedCitation,
} from './citation'
import type { EvidenceReference } from './evidence'
import {
  createVerificationFindingId,
  verificationFindingSchema,
  type FindingConfidence,
  type FindingSeverity,
  type VerificationFinding,
} from './finding'
import type { VerificationSubject } from './subject'

export type AuthorityExistenceOutcome =
  | { outcome: 'held'; evidence: EvidenceReference[] }
  | { outcome: 'not_held'; missing: 'authority' | 'provision' }
  | { outcome: 'ambiguous' }
  | {
      outcome: 'unavailable'
      reason:
        | 'store_error'
        | 'malformed_record'
        | 'source_withdrawn'
        | 'identity_mismatch'
        | 'citation_underspecified'
    }
  | { outcome: 'skipped' }

export interface AuthorityExistenceDecisionInput {
  subject: VerificationSubject
  citation: CitationInput
  normalizedCitation: NormalizedCitation
  outcome: AuthorityExistenceOutcome
}

interface DecidedOutcome {
  status: VerificationFinding['status']
  severity: FindingSeverity | null
  confidence: FindingConfidence | null
  evidence: EvidenceReference[]
  explanation: string
}

function unresolvedExplanation(
  reason: Exclude<CitationUnresolvedReason, 'ambiguous'>,
) {
  switch (reason) {
    case 'not_a_citation':
      return 'Obiter does not recognise this as a citation format it can check, so no authority check ran. Check the citation before relying on it.'
    case 'unsupported_source_type':
      return 'Obiter does not check citations to this court or source type, so no authority check ran.'
    case 'no_canonical_match':
      return 'No stored source in Obiter matches this citation, so no authority check ran. Check the citation before relying on it.'
    case 'resolution_unavailable':
      return 'Obiter could not read the stored records needed to check this citation, so no authority check ran. Try again before relying on it.'
    default: {
      const unhandled: never = reason
      return unhandled
    }
  }
}

function isResolved(
  citation: NormalizedCitation,
): citation is Extract<
  NormalizedCitation,
  { kind: 'case_law' | 'legislation' }
> {
  return citation.kind === 'case_law' || citation.kind === 'legislation'
}

function decide(input: AuthorityExistenceDecisionInput): DecidedOutcome {
  const citation = input.normalizedCitation
  const resolved = isResolved(citation)

  if (resolved && input.outcome.outcome === 'skipped') {
    throw new Error('A resolved citation requires a store lookup outcome.')
  }
  if (!resolved && input.outcome.outcome !== 'skipped') {
    throw new Error(
      'An unresolved citation cannot carry a store lookup outcome.',
    )
  }

  if (citation.kind === 'not_checked') {
    return {
      status: { state: 'not_checked' },
      severity: null,
      confidence: null,
      evidence: [],
      explanation: 'The authority existence check did not run.',
    }
  }

  if (citation.kind === 'unresolved') {
    if (citation.reason === 'ambiguous') {
      return {
        status: { state: 'review_required', reason: 'citation_ambiguous' },
        severity: 'medium',
        confidence: 'low',
        evidence: [],
        explanation:
          'The citation is ambiguous, so it was not checked against the stored public sources. A reviewer must resolve which authority it names.',
      }
    }
    return {
      status: { state: 'review_required', reason: 'citation_unresolved' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
      explanation: unresolvedExplanation(citation.reason),
    }
  }

  switch (input.outcome.outcome) {
    case 'skipped':
      throw new Error('A resolved citation requires a store lookup outcome.')
    case 'held':
      if (input.outcome.evidence.length === 0) {
        return {
          status: { state: 'review_required', reason: 'evidence_unavailable' },
          severity: 'medium',
          confidence: 'low',
          evidence: [],
          explanation:
            'A stored public source matches the citation, but no addressable evidence is available for it, so the check is inconclusive.',
        }
      }
      return {
        status: { state: 'clear' },
        severity: 'low',
        confidence: 'high',
        evidence: input.outcome.evidence,
        explanation: 'One stored public source matches the citation.',
      }
    case 'not_held':
      if (
        citation.kind === 'case_law' &&
        input.outcome.missing === 'provision'
      ) {
        throw new Error(
          'A case-law citation cannot be missing a provision; only a held Act has provisions.',
        )
      }
      return {
        status: { state: 'review_required', reason: 'authority_not_held' },
        severity: 'high',
        confidence: 'medium',
        evidence: [],
        explanation:
          input.outcome.missing === 'provision'
            ? 'The Act is held, but the cited provision is not held by Obiter. This is an availability result, not a finding that the provision is fictitious.'
            : 'No stored public source matches the citation, so it is not held by Obiter. This is an availability result, not a finding that the authority is fictitious.',
      }
    case 'ambiguous':
      return {
        status: { state: 'review_required', reason: 'check_inconclusive' },
        severity: 'medium',
        confidence: 'medium',
        evidence: [],
        explanation:
          'More than one stored public source matches the citation, so the check cannot conclude without a reviewer.',
      }
    case 'unavailable':
      if (input.outcome.reason === 'source_withdrawn') {
        return {
          status: { state: 'review_required', reason: 'evidence_unavailable' },
          severity: 'medium',
          confidence: 'low',
          evidence: [],
          explanation:
            'Every stored public source matching the citation is withdrawn upstream, so the check is inconclusive.',
        }
      }
      if (input.outcome.reason === 'identity_mismatch') {
        return {
          status: { state: 'review_required', reason: 'check_inconclusive' },
          severity: 'medium',
          confidence: 'low',
          evidence: [],
          explanation:
            "The citation's stored identity does not agree with the stored public record, so the check is inconclusive.",
        }
      }
      if (input.outcome.reason === 'malformed_record') {
        return {
          status: { state: 'review_required', reason: 'check_inconclusive' },
          severity: 'medium',
          confidence: 'low',
          evidence: [],
          explanation:
            'A stored public source record could not be validated, so the check is inconclusive. This is not a not-held result.',
        }
      }
      if (input.outcome.reason === 'citation_underspecified') {
        return {
          status: { state: 'review_required', reason: 'check_inconclusive' },
          severity: 'medium',
          confidence: 'low',
          evidence: [],
          explanation:
            'The Act is held, but the citation names no schedule and the store cannot resolve it without guessing, so the check is inconclusive.',
        }
      }
      return {
        status: { state: 'review_required', reason: 'check_inconclusive' },
        severity: 'medium',
        confidence: 'low',
        evidence: [],
        explanation:
          'The stored public source record could not be read, so the check is inconclusive. This is not a not-held result.',
      }
  }
}

export function decideAuthorityExistence(
  input: AuthorityExistenceDecisionInput,
): VerificationFinding {
  const decided = decide(input)
  return verificationFindingSchema.parse({
    id: createVerificationFindingId({
      subject: input.subject,
      type: 'authority_existence',
      location: input.citation.location,
    }),
    type: 'authority_existence',
    subject: input.subject,
    citation: input.citation,
    normalizedCitation: input.normalizedCitation,
    status: decided.status,
    severity: decided.severity,
    confidence: decided.confidence,
    evidence: decided.evidence,
    explanation: decided.explanation,
  })
}
