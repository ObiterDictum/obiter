import type { CitationInput, NormalizedCitation } from './citation'
import type { EvidenceReference } from './evidence'
import {
  createVerificationFindingId,
  verificationFindingSchema,
  type FindingConfidence,
  type FindingSeverity,
  type VerificationFinding,
} from './finding'
import type { VerificationSubject } from './subject'

/**
 * What a lookup found for a citation that resolved to an identity. The shape
 * is source-independent: the only public source material it names is the
 * evidence a finding rests on, so a store boundary can build it without this
 * package importing a database or a provider.
 *
 * - `held`: a trustworthy stored source matches. `evidence` names the stored
 *   source: the document identity itself for a whole-authority match, or the
 *   provision for a provision-level one. The decision withholds the clear if a
 *   caller reports a held source with no evidence at all rather than inventing
 *   an anchor.
 * - `not_held`: no trustworthy stored source matches. `missing` separates an
 *   absent authority from an absent provision of a held Act, because the two
 *   read differently to a reviewer. Neither claims the authority is fictitious.
 * - `ambiguous`: more than one stored source matches. There is no winner.
 * - `unavailable`: the lookup could not answer, because the store failed, a
 *   stored row failed its schema, the only matching source is withdrawn
 *   upstream, the citation's stored identity disagrees with the record, or a
 *   schedule citation is underspecified. This is not an absence. The `reason`
 *   is the operational category: a database that is down and a schema-invalid
 *   row both make the check inconclusive, but they are different failures and
 *   a caller must be able to tell them apart without reading the explanation.
 * - `skipped`: no lookup ran, because the citation never resolved to an
 *   identity.
 */
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
  /** Required for a resolved citation, `skipped` otherwise. */
  outcome: AuthorityExistenceOutcome
}

interface DecidedOutcome {
  status: VerificationFinding['status']
  severity: FindingSeverity | null
  confidence: FindingConfidence | null
  evidence: EvidenceReference[]
  explanation: string
}

function isResolved(
  citation: NormalizedCitation,
): citation is Extract<
  NormalizedCitation,
  { kind: 'case_law' | 'legislation' }
> {
  return citation.kind === 'case_law' || citation.kind === 'legislation'
}

/**
 * The authority-existence truth table. It answers one question, and every
 * branch fails closed: a citation that did not resolve is never cleared, a
 * store that could not answer is never read as absent, and a held source with
 * no evidence is reviewed rather than cleared. Nothing here writes, and the
 * only public source named is the evidence the caller already looked up.
 */
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
      explanation:
        'The citation could not be normalised to a public source identity, so no existence check ran.',
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
        // Case law has no provisions, so a "missing provision of a held case"
        // is a contradiction, not an outcome. Reject it here rather than emit
        // the Act-worded explanation for a judgment citation.
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

/**
 * One authority-existence finding for a cited authority and a lookup outcome.
 * The returned value is an accepted finding state, so a caller cannot wrap the
 * decision in a status the truth table refuses. Evidence is validated against
 * the resolved citation by the finding schema: a lookup that reports a held
 * source but hands over another source's evidence fails loudly rather than
 * producing a clear finding it cannot support.
 */
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
