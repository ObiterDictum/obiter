import { z } from 'zod'
import { citationInputSchema, normalizedCitationSchema } from './citation'
import { evidenceReferenceSchema } from './evidence'
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

/** How much the check trusts its own outcome. */
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
 *   evidence.
 * - `flagged` means the check ran and found a problem.
 * - `not_checked` means the check did not run. It is not a pass.
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
 * on. `not_checked` counts: an unrun check is unknown, not a pass. The switch is
 * exhaustive by construction, so a new status without a branch fails the
 * typecheck rather than defaulting to "no review needed".
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
  }
}

/**
 * One check outcome, tied to the citation and the public evidence it rests on.
 * Every field is an id, an enumeration or a spatial reference; the only text is
 * the citation string, plus a reviewer explanation authored by Verify. No field
 * holds draft or source text.
 */
export const verificationFindingSchema = z
  .object({
    id: z.string().trim().min(1),
    type: findingTypeSchema,
    subject: verificationSubjectSchema,
    citation: citationInputSchema,
    normalizedCitation: normalizedCitationSchema,
    status: findingStatusSchema,
    severity: findingSeveritySchema,
    confidence: findingConfidenceSchema,
    evidence: z.array(evidenceReferenceSchema),
    /** Authored by Verify from the finding's own facts, never copied from the
     * matter under verification. */
    explanation: z.string().trim().min(1),
  })
  .strict()
  .superRefine((finding, context) => {
    if (finding.status.state !== 'clear') return
    if (finding.normalizedCitation.kind === 'unresolved') {
      context.addIssue({
        code: 'custom',
        path: ['status', 'state'],
        message: 'A check on an unresolved citation cannot be clear.',
      })
    }
    if (finding.evidence.length === 0) {
      context.addIssue({
        code: 'custom',
        path: ['evidence'],
        message: 'A clear finding must cite the evidence it rests on.',
      })
    }
  })
export type VerificationFinding = z.infer<typeof verificationFindingSchema>

/**
 * Stable finding identity for idempotent re-runs: the same subject, check and
 * draft location yields the same id every time, and the id changes when any of
 * those change. The normalized citation is deliberately excluded, so a later
 * normaliser change does not re-key existing findings. The parts are opaque ids
 * and offsets, so the id never carries matter text.
 */
export function createVerificationFindingId(input: {
  subject: VerificationSubject
  type: FindingType
  location: DraftLocation
}): string {
  const { subject, type, location } = input
  return `vf:${subject.documentId}:${subject.versionId}:${type}:${location.paragraphId}:${location.start}-${location.end}`
}
