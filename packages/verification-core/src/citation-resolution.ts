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
 * The resolved arms of `NormalizedCitation`: exactly the identity the
 * authority-existence check accepts as its input. A resolved citation is not a
 * search hit, a title or a display string; it is the canonical source identity
 * a check can act on, and it keeps its authority family so a judgment can never
 * be consumed as an Act or the reverse.
 */
export type ResolvedCitation = Extract<
  NormalizedCitation,
  { kind: 'case_law' | 'legislation' }
>

/**
 * What citation resolution established for one raw citation candidate, before
 * anything is looked up in a store. It is the resolution layer's own result
 * model, deliberately separate from the V1 finding: a failure here is a
 * statement about resolving raw text, never about whether an authority is held.
 *
 * - `resolved`: exactly one canonical authority identity. It is what V2 needs
 *   and all V2 gets.
 * - `unresolved`: the candidate is citation-shaped and inside the accepted
 *   grammar, but no canonical identity could be established for it. Zero
 *   candidates is this, and it is never a claim that the authority does not
 *   exist.
 * - `ambiguous`: more than one canonical identity remains possible. There is no
 *   winner, and resolution never falls back to the first match.
 * - `malformed`: the candidate is outside the accepted citation grammar (a
 *   malformed bracket, a missing year, court or number, appended prose, a
 *   hidden character).
 * - `unsupported`: the candidate is a citation of a source family this layer
 *   does not resolve.
 * - `inconclusive`: an operational dependency failed. It is not a negative
 *   result and must not be reported as one; `reason` keeps the failure
 *   category for an operational caller.
 * - `not_checked`: resolution did not run. It is not a pass and it claims
 *   nothing.
 */
export type CitationResolution =
  | { outcome: 'resolved'; citation: ResolvedCitation }
  | { outcome: 'unresolved' }
  | { outcome: 'ambiguous' }
  | { outcome: 'malformed' }
  | { outcome: 'unsupported' }
  | { outcome: 'inconclusive'; reason: 'store_error' }
  | { outcome: 'not_checked' }

/**
 * The V1 citation state a resolution maps onto, so the resolution can be
 * persisted as a finding and handed to V2.
 *
 * This mapping is the safety boundary: every non-resolved outcome becomes an
 * `unresolved` or `not_checked` citation, which the authority-existence check
 * can only skip. A malformed, ambiguous, unresolved or inconclusive result
 * therefore cannot enter V2 as a resolved identity, and no branch invents an
 * identity for a candidate that has none.
 */
export function normalizedCitationFromResolution(
  resolution: CitationResolution,
): NormalizedCitation {
  switch (resolution.outcome) {
    case 'resolved':
      return resolution.citation
    case 'unresolved':
      return { kind: 'unresolved', reason: 'no_canonical_match' }
    case 'ambiguous':
      return { kind: 'unresolved', reason: 'ambiguous' }
    case 'malformed':
      return { kind: 'unresolved', reason: 'not_a_citation' }
    case 'unsupported':
      return { kind: 'unresolved', reason: 'unsupported_source_type' }
    case 'inconclusive':
      return { kind: 'unresolved', reason: 'resolution_unavailable' }
    case 'not_checked':
      return { kind: 'not_checked' }
    default: {
      const unhandled: never = resolution
      return unhandled
    }
  }
}

/**
 * The evidence a resolved citation rests on, at the granularity its identity
 * has: the stored judgment document for case law, the Act or its provision for
 * legislation. Resolution names the source it resolved to and nothing inside a
 * source it did not read, so a provision citation evidences the provision and a
 * whole Act evidences the Act.
 */
function resolutionEvidence(citation: ResolvedCitation): EvidenceReference {
  switch (citation.kind) {
    case 'case_law':
      return {
        sourceType: 'judgment',
        granularity: 'document',
        sourceId: citation.sourceId,
      }
    case 'legislation':
      return citation.labelPath === null
        ? {
            sourceType: 'legislation_document',
            granularity: 'document',
            sourceId: citation.documentIdentity,
          }
        : {
            sourceType: 'legislation_provision',
            granularity: 'fragment',
            sourceId: citation.documentIdentity,
            labelPath: citation.labelPath,
          }
    default: {
      const unhandled: never = citation
      return unhandled
    }
  }
}

export interface CitationResolutionDecisionInput {
  subject: VerificationSubject
  citation: CitationInput
  resolution: CitationResolution
}

interface DecidedResolution {
  status: VerificationFinding['status']
  severity: FindingSeverity | null
  confidence: FindingConfidence | null
  evidence: EvidenceReference[]
  explanation: string
}

/**
 * The citation-resolution truth table. Every branch fails closed: an uncertain
 * resolution is review-required rather than a pass, and only one canonical
 * identity can ever produce a clear. Nothing here claims an authority is held
 * or absent, and no branch quotes the candidate, so the explanation stays free
 * of matter text.
 */
function decide(input: CitationResolutionDecisionInput): DecidedResolution {
  const resolution = input.resolution
  if (resolution.outcome === 'resolved') {
    return {
      status: { state: 'clear' },
      severity: 'low',
      confidence: 'high',
      evidence: [resolutionEvidence(resolution.citation)],
      explanation: 'The citation resolved to one canonical public source.',
    }
  }
  if (resolution.outcome === 'not_checked') {
    return {
      status: { state: 'not_checked' },
      severity: null,
      confidence: null,
      evidence: [],
      explanation: 'The citation resolution check did not run.',
    }
  }
  if (resolution.outcome === 'ambiguous') {
    return {
      status: { state: 'review_required', reason: 'citation_ambiguous' },
      severity: 'medium',
      confidence: 'medium',
      evidence: [],
      explanation:
        'More than one canonical public source satisfies the citation, so it does not resolve to one identity. A reviewer must decide which authority it names.',
    }
  }
  if (resolution.outcome === 'inconclusive') {
    return {
      status: { state: 'review_required', reason: 'check_inconclusive' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
      explanation:
        'The stored public source record could not be read, so the citation could not be resolved to a canonical identity. This is not a result about whether the authority exists.',
    }
  }
  if (resolution.outcome === 'unresolved') {
    return {
      status: { state: 'review_required', reason: 'citation_unresolved' },
      severity: 'medium',
      confidence: 'low',
      evidence: [],
      explanation:
        'No canonical public source identity matched the citation, so no identity was available to check. This is not a result about whether the authority exists.',
    }
  }
  return {
    status: { state: 'review_required', reason: 'citation_unresolved' },
    severity: 'medium',
    confidence: 'low',
    evidence: [],
    explanation:
      resolution.outcome === 'unsupported'
        ? 'The citation names a source family this check does not resolve, so no canonical identity was produced.'
        : 'The citation is not a recognised citation form, so no canonical identity was produced.',
  }
}

/**
 * One citation-resolution finding for a raw candidate and its resolution. The
 * returned value is an accepted finding state, so a caller cannot wrap the
 * decision in a status the truth table refuses: a non-resolved citation can
 * never be cleared, and `authority_not_held` is unreachable here because it
 * belongs to the authority-existence check.
 */
export function decideCitationResolution(
  input: CitationResolutionDecisionInput,
): VerificationFinding {
  const decided = decide(input)
  return verificationFindingSchema.parse({
    id: createVerificationFindingId({
      subject: input.subject,
      type: 'citation_resolution',
      location: input.citation.location,
    }),
    type: 'citation_resolution',
    subject: input.subject,
    citation: input.citation,
    normalizedCitation: normalizedCitationFromResolution(input.resolution),
    status: decided.status,
    severity: decided.severity,
    confidence: decided.confidence,
    evidence: decided.evidence,
    explanation: decided.explanation,
  })
}
