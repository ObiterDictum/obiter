import { z } from 'zod'
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

/**
 * The check a finding reports. Deliberately limited to the M1 checks that
 * `docs/specs/verify/implementation.md` scopes; proposition support arrives
 * with V8 as an added member.
 */
export const findingTypeSchema = z.enum([
  'authority_existence',
  'citation_resolution',
  'quote_fidelity',
])
export type FindingType = z.infer<typeof findingTypeSchema>

/** How much the finding matters to a reviewer. Mapping a type to a severity is
 * policy, and belongs to the check, not to this vocabulary. */
export const findingSeveritySchema = z.enum(['high', 'medium', 'low'])
export type FindingSeverity = z.infer<typeof findingSeveritySchema>

/** How much the check trusts its own outcome. A check that did not run has no
 * outcome to trust, so `not_checked` findings carry `null` here. */
export const findingConfidenceSchema = z.enum(['high', 'medium', 'low'])
export type FindingConfidence = z.infer<typeof findingConfidenceSchema>

/**
 * Why a check could not conclude. `authority_not_held` exists because the held
 * sources are partial: not finding an authority is not proof that it does not
 * exist, so a missing source is a review obligation rather than a flagged
 * problem.
 */
export const reviewReasonSchema = z.enum([
  'citation_ambiguous',
  'citation_unresolved',
  'authority_not_held',
  'evidence_unavailable',
  'check_inconclusive',
])
export type ReviewReason = z.infer<typeof reviewReasonSchema>

/**
 * The conservative outcome of a check.
 *
 * - `clear` means the check ran and found nothing to flag. It is the only
 *   outcome that reads as "no issue", and a finding cannot reach it without
 *   evidence for a resolved source.
 * - `flagged` means the check ran and found a problem, evidenced the same way.
 * - `not_checked` means the check did not run. It is not a pass, and it claims
 *   nothing: no citation state, no evidence, no severity or confidence.
 * - `review_required` means the check could not conclude and a human must look.
 *   A reason is mandatory, so uncertainty cannot be recorded without one.
 */
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

/**
 * Whether the status obliges a human to review before the finding can be relied
 * on. `not_checked` counts: an unrun check is unknown, not a pass. Every branch
 * returns, and the `never` guard makes a new status member a typecheck failure
 * rather than a silent fall-through to "no review needed".
 */
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

/**
 * `authority_not_held` names the authority-existence check's own verdict, so
 * only that check may report it. A check that merely cannot reach a source
 * reports `evidence_unavailable` or `check_inconclusive`; the other reasons
 * describe a shared condition rather than another check's outcome.
 */
function reviewReasonContradictsType(
  reason: ReviewReason,
  type: FindingType,
): boolean {
  return reason === 'authority_not_held' && type !== 'authority_existence'
}

/** Whether an evidence reference names the same public source as a resolved
 * citation. Judgment and legislation references cannot cross, and the source id
 * must match exactly; a label path within the source is not required to match,
 * because a quote-fidelity check can legitimately evidence a different
 * provision of the same Act. A document-level reference and a fragment-level
 * reference of the same source both match here; which granularity a finding
 * type accepts is enforced separately. */
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

/**
 * Whether a finding type needs fragment-level evidence, or is satisfied by the
 * document identity itself.
 *
 * - A quote or proposition check supports text inside a source, so it needs a
 *   fragment; a document reference cannot say where the supported text lives.
 * - A provision-specific finding (`legislation` with a `labelPath`) needs the
 *   provision fragment it names.
 * - Everything else, including a whole-authority existence check and a
 *   whole-Act one, rests on the document identity and so needs document-level
 *   evidence rather than an arbitrary fragment of the document.
 */
function requiresFragmentEvidence(finding: FindingShape): boolean {
  if (finding.type === 'quote_fidelity') return true
  const citation = finding.normalizedCitation
  return citation.kind === 'legislation' && citation.labelPath !== null
}

/** The accepted finding states, as one invariant. Every rule is stated in both
 * directions: what a status requires, and what the presence of a value implies
 * about the status. `docs/specs/verify/domain-model.md` records the truth table
 * this implements, and `finding-states.test.ts` exercises it. */
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
    // A finding type that supports text inside a source needs a fragment; one
    // that claims the source itself needs the document. A fragment cannot
    // stand in for the document identity, and the document cannot stand in for
    // the supported text, so neither granularity may substitute for the other.
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
    /** The generated identity, constrained below to exactly
     * `createVerificationFindingId`'s output. */
    id: z.string().min(1),
    type: findingTypeSchema,
    subject: verificationSubjectSchema,
    citation: citationInputSchema,
    normalizedCitation: normalizedCitationSchema,
    status: findingStatusSchema,
    severity: findingSeveritySchema.nullable(),
    confidence: findingConfidenceSchema.nullable(),
    evidence: z.array(evidenceReferenceSchema),
    /** Authored by Verify from the finding's own facts. It may quote matter, so
     * it is a payload field rather than an identifier. */
    explanation: z.string().trim().min(1),
  })
  .strict()

type FindingViolation = { path: (string | number)[]; message: string }
type FindingShape = z.infer<typeof findingShape>

/**
 * One check outcome, tied to the citation and the public evidence it rests on.
 * Every field is an id, an enumeration or a spatial reference, except
 * `citation.rawText` (the cited string, which can carry party names) and
 * `explanation` (authored by Verify, and able to quote matter). String sizes
 * are deliberately unbounded here: this package is pure and trusted, and the
 * API and queue boundaries that will accept these values own request-size
 * limits before persistence.
 */
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

/**
 * A component is encoded as its UTF-16 length, a `:`, and the component. The
 * join is injective by construction: a decoder reads the length first, so a
 * component that contains `:` cannot be mistaken for a delimiter. Two different
 * subjects, types or spans can therefore never collapse onto one id, and an
 * empty component (`0:`) is distinct from a missing one.
 */
function encodeIdComponent(value: string | number): string {
  const text = `${value}`
  return `${text.length}:${text}`
}

/**
 * The stable identity of a finding: the same subject version, check type and
 * draft location yields the same id on every run, and it changes when any of
 * those change. The normalized citation is deliberately excluded, so a later
 * normaliser change does not re-key existing findings.
 *
 * Ownership: this is a deterministic idempotency key scoped to one immutable
 * draft version, and it is also the identity V5 persists. It is not a per-run
 * key and not a content hash: nothing is hashed, and collisions are impossible
 * by the encoding rather than improbable. Because a re-run of the same version
 * reproduces it, a persistence table that records findings per run must scope
 * its own key by run id (for example a unique `(run_id, finding_id)`) rather
 * than use this value as a per-run primary key. The components are the subject,
 * type and location ids and offsets, so no citation text, quote, explanation,
 * filename, matter name or user text enters it.
 */
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
    encodeIdComponent(location.paragraphId),
    encodeIdComponent(location.start),
    encodeIdComponent(location.end),
  ].join(':')
}
