import { z } from 'zod'
import { verificationPassageSchema } from '@obiter/contracts'
import {
  citationInputSchema,
  normalizedCitationSchema,
  type NormalizedCitation,
} from './citation'
import {
  createEvidenceReferenceId,
  evidenceReferenceSchema,
  isDocumentEvidenceReference,
  isFragmentEvidenceReference,
  type EvidenceReference,
} from './evidence'
import type { DraftLocation } from './subject'
import { verificationSubjectSchema, type VerificationSubject } from './subject'

export const findingTypeSchema = z.enum([
  'authority_existence',
  'citation_resolution',
  'quote_fidelity',
])
export type FindingType = z.infer<typeof findingTypeSchema>

export const findingSeveritySchema = z.enum(['high', 'medium', 'low'])
export type FindingSeverity = z.infer<typeof findingSeveritySchema>

export const findingConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type FindingConfidence = z.infer<typeof findingConfidenceSchema>

export const reviewReasonSchema = z.enum([
  'citation_ambiguous',
  'citation_unresolved',
  'authority_not_held',
  'evidence_unavailable',
  'check_inconclusive',
])
export type ReviewReason = z.infer<typeof reviewReasonSchema>

export const findingStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('clear') }).strict(),
  z.object({ state: z.literal('flagged') }).strict(),
  z.object({ state: z.literal('not_checked') }).strict(),
  z
    .object({
      state: z.literal('review_required'),
      reason: reviewReasonSchema,
    })
    .strict(),
])
export type FindingStatus = z.infer<typeof findingStatusSchema>

export function requiresReview(status: FindingStatus): boolean {
  switch (status.state) {
    case 'clear':
      return false
    case 'flagged':
      return false
    case 'not_checked':
      return true
    case 'review_required':
      return true
    default: {
      const unhandled: never = status
      return unhandled
    }
  }
}

function reviewReasonContradictsType(
  reason: ReviewReason,
  type: FindingType,
): boolean {
  return reason === 'authority_not_held' && type !== 'authority_existence'
}

function evidenceMatchesCitation(
  citation: NormalizedCitation,
  reference: EvidenceReference,
): boolean {
  switch (citation.kind) {
    case 'case_law':
      return (
        reference.sourceType === 'judgment' &&
        reference.sourceId === citation.sourceId
      )
    case 'legislation':
      return (
        reference.sourceType !== 'judgment' &&
        reference.sourceId === citation.documentIdentity
      )
    case 'unresolved':
    case 'not_checked':
      return false
  }
}

function requiresFragmentEvidence(finding: FindingShape): boolean {
  if (finding.type === 'quote_fidelity') return true
  const citation = finding.normalizedCitation
  return citation.kind === 'legislation' && citation.labelPath !== null
}

function findingViolations(finding: FindingShape): FindingViolation[] {
  const violations: FindingViolation[] = []
  const add = (path: FindingViolation['path'], message: string) =>
    violations.push({ path, message })
  const citation = finding.normalizedCitation
  const resolved =
    citation.kind === 'case_law' || citation.kind === 'legislation'
  const state = finding.status.state

  if (
    finding.id !==
    createVerificationFindingId({
      subject: finding.subject,
      type: finding.type,
      location: finding.citation.location,
    })
  ) {
    add(
      ['id'],
      'A finding id must be the canonical identity of its subject, type and draft location.',
    )
  }

  if (state === 'not_checked') {
    if (citation.kind !== 'not_checked') {
      add(
        ['normalizedCitation'],
        'A check that did not run cannot claim a citation state.',
      )
    }
    if (finding.severity !== null || finding.confidence !== null) {
      add(
        ['severity'],
        'A check that did not run cannot carry a severity or confidence.',
      )
    }
    if (finding.evidence.length > 0) {
      add(['evidence'], 'A check that did not run cannot rest on evidence.')
    }
    return violations
  }

  if (citation.kind === 'not_checked') {
    add(
      ['normalizedCitation'],
      'Only a check that did not run can leave the citation unchecked.',
    )
  }

  if (finding.severity === null || finding.confidence === null) {
    add(
      ['severity'],
      'A completed check must state its severity and confidence.',
    )
  }

  if (finding.status.state === 'review_required') {
    const { reason } = finding.status
    if (reason === 'citation_unresolved' && citation.kind !== 'unresolved') {
      add(
        ['status', 'reason'],
        'A citation_unresolved review cannot rest on a citation with an identity.',
      )
    }
    if (reason === 'citation_ambiguous') {
      if (citation.kind !== 'unresolved') {
        add(
          ['status', 'reason'],
          'A citation_ambiguous review cannot rest on a citation with an identity.',
        )
      } else if (citation.reason !== 'ambiguous') {
        add(
          ['status', 'reason'],
          'A citation_ambiguous review requires an ambiguous citation.',
        )
      }
    }
    if (
      (reason === 'authority_not_held' || reason === 'evidence_unavailable') &&
      !resolved
    ) {
      add(
        ['status', 'reason'],
        'This review reason requires a resolved citation identity.',
      )
    }
    if (reviewReasonContradictsType(reason, finding.type)) {
      add(
        ['status', 'reason'],
        'Only the authority_existence check can report authority_not_held.',
      )
    }
    if (reason !== 'check_inconclusive' && finding.evidence.length > 0) {
      add(
        ['evidence'],
        'Only an inconclusive check may carry evidence into review.',
      )
    }
  }

  if (state === 'clear' || state === 'flagged') {
    if (!resolved) {
      add(
        ['normalizedCitation'],
        'A clear or flagged finding must rest on a resolved citation.',
      )
    }
    if (finding.evidence.length === 0) {
      add(
        ['evidence'],
        'A clear or flagged finding must cite the evidence it rests on.',
      )
    }
    const hasFragment = finding.evidence.some(isFragmentEvidenceReference)
    const hasDocument = finding.evidence.some(isDocumentEvidenceReference)
    if (requiresFragmentEvidence(finding) && !hasFragment) {
      add(
        ['evidence'],
        'This finding type requires fragment-level evidence; document-level evidence cannot satisfy it.',
      )
    }
    if (!requiresFragmentEvidence(finding) && !hasDocument) {
      add(
        ['evidence'],
        'A whole-authority finding requires document-level evidence; a fragment cannot substitute for the authority identity.',
      )
    }
  }

  if (!resolved && finding.evidence.length > 0) {
    add(['evidence'], 'Evidence requires a resolved citation identity.')
  }

  if (resolved) {
    for (const [index, reference] of finding.evidence.entries()) {
      if (!evidenceMatchesCitation(citation, reference)) {
        add(
          ['evidence', index],
          'Evidence must name the same source as the resolved citation.',
        )
      }
    }
  }

  if (
    new Set(finding.evidence.map(createEvidenceReferenceId)).size !==
    finding.evidence.length
  ) {
    add(['evidence'], 'Duplicate evidence references are not meaningful.')
  }

  return violations
}

const findingShape = z
  .object({
    id: z.string().min(1),
    type: findingTypeSchema,
    subject: verificationSubjectSchema,
    citation: citationInputSchema,
    normalizedCitation: normalizedCitationSchema,
    status: findingStatusSchema,
    severity: findingSeveritySchema.nullable(),
    confidence: findingConfidenceSchema.nullable(),
    evidence: z.array(evidenceReferenceSchema),
    passages: z.array(verificationPassageSchema).optional(),
    explanation: z.string().trim().min(1),
  })
  .strict()

type FindingViolation = { path: (string | number)[]; message: string }
type FindingShape = z.infer<typeof findingShape>

export const verificationFindingSchema = findingShape.superRefine(
  (finding, context) => {
    for (const violation of findingViolations(finding)) {
      context.addIssue({
        code: 'custom',
        path: violation.path,
        message: violation.message,
      })
    }
  },
)
export type VerificationFinding = z.infer<typeof verificationFindingSchema>

function encodeIdComponent(value: string | number): string {
  const text = `${value}`
  return `${text.length}:${text}`
}

export function createVerificationFindingId(input: {
  subject: VerificationSubject
  type: FindingType
  location: DraftLocation
}): string {
  const { subject, type, location } = input
  return [
    'vf',
    encodeIdComponent(subject.documentId),
    encodeIdComponent(subject.versionId),
    encodeIdComponent(type),
    encodeIdComponent(location.storyKind ?? ''),
    encodeIdComponent(location.storyPartName ?? ''),
    encodeIdComponent(location.paragraphId),
    encodeIdComponent(location.start),
    encodeIdComponent(location.end),
  ].join(':')
}
