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

export type ResolvedCitation = Extract<
  NormalizedCitation,
  { kind: 'case_law' | 'legislation' }
>

export type CitationResolution =
  | { outcome: 'resolved'; citation: ResolvedCitation }
  | { outcome: 'unresolved' }
  | { outcome: 'ambiguous' }
  | { outcome: 'malformed' }
  | { outcome: 'unsupported' }
  | { outcome: 'inconclusive'; reason: 'store_error' }
  | { outcome: 'not_checked' }

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
        'No stored source in Obiter matches this citation, so there is nothing to check it against. That says what Obiter holds, not whether the authority exists.',
    }
  }
  return {
    status: { state: 'review_required', reason: 'citation_unresolved' },
    severity: 'medium',
    confidence: 'low',
    evidence: [],
    explanation:
      resolution.outcome === 'unsupported'
        ? 'Obiter does not check citations to this court or source type, so nothing was checked.'
        : 'Obiter does not recognise this as a citation format it can check, so nothing was checked. Check the citation before relying on it.',
  }
}

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
