import type {
  SpanCategory,
  SpanConfidence,
  SpanDecision,
  SpanSource,
} from '@obiter/contracts'
import type {
  Decisions,
  DecisionRecord,
  RedactionSpan,
} from '@obiter/redaction-policy'

/**
 * What a reviewer is told about one detected span. Kept in one place so the
 * panel, the decision bar and the document marks cannot describe the same span
 * differently — a span whose confidence reads "high" in the list and "needs
 * review" on the page is a disclosure risk, not a cosmetic bug.
 */

export const categoryLabel = {
  person_name: 'Person name',
  email: 'Email address',
  phone: 'Phone number',
  address: 'Address',
  date: 'Date',
  government_id: 'Government ID',
  account_number: 'Account number',
  passport: 'Passport number',
  drivers_license: 'Driving licence',
  url: 'Web address',
  ip_address: 'IP address',
  national_insurance: 'National Insurance number',
  case_reference: 'Case reference',
  organisation_name: 'Organisation name',
  secret: 'Secret',
} satisfies Record<SpanCategory, string>

export const sourceLabel = {
  rampart_model: 'Rampart model',
  rampart_deterministic: 'Pattern match',
  uk_supplement: 'UK supplement',
} satisfies Record<SpanSource, string>

/** How each detector works, so a reviewer can calibrate what a hit means. */
export const sourceExplanation = {
  rampart_model: 'found by the Rampart model reading the text',
  rampart_deterministic: 'matched a fixed pattern such as an email address',
  uk_supplement: 'matched a UK-specific pattern',
} satisfies Record<SpanSource, string>

export const confidenceLabel = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
} satisfies Record<SpanConfidence, string>

export const confidenceExplanation = {
  high: 'the shape of the match is unambiguous',
  medium: 'the match partly fits the pattern, so read the surrounding text',
  low: 'a weak match — check it before deciding',
} satisfies Record<SpanConfidence, string>

/**
 * Detection confidence describes detection only. REVIEW-professional found
 * "High confidence" read as confidence that disclosure is safe, so every
 * confidence statement carries this qualifier.
 */
export const CONFIDENCE_CAVEAT =
  'Detection confidence is not a disclosure decision.'

export const DETECTION_COVERAGE_CAVEAT =
  'Detection finds candidates, not everything sensitive in a document.'

export const decisionLabel = {
  accept: 'Redact',
  reject: 'Keep visible',
  override_redact: 'Override to redact',
  override_keep: 'Override to keep',
  pseudonymise: 'Pseudonymise',
} satisfies Record<SpanDecision, string>

export const decisionDescription = {
  accept: 'Replace this text in the redacted copy.',
  reject: 'Leave this text in the copy.',
  override_redact: 'Redact it even though the detector suggested keeping it.',
  override_keep: 'Keep it even though the detector suggested redacting it.',
  pseudonymise: 'Replace it with a category token in a pseudonymised copy.',
} satisfies Record<SpanDecision, string>

export type SpanDecisionState =
  'accepted' | 'rejected' | 'pseudonymised' | 'pending'

/** What the document paints for a span: decided for removal, kept, or open. */
export function spanDecisionState(
  decision: SpanDecision | undefined,
): SpanDecisionState {
  if (!decision) return 'pending'
  if (decision === 'accept' || decision === 'override_redact') return 'accepted'
  if (decision === 'pseudonymise') return 'pseudonymised'
  return 'rejected'
}

export const decisionStateLabel = {
  accepted: 'Redacted',
  rejected: 'Kept visible',
  pseudonymised: 'Pseudonymised',
  pending: 'Needs review',
} satisfies Record<SpanDecisionState, string>

export const decisionStateTone = {
  accepted: 'success',
  rejected: 'neutral',
  pseudonymised: 'info',
  pending: 'warning',
} satisfies Record<
  SpanDecisionState,
  'success' | 'neutral' | 'info' | 'warning'
>

/**
 * Marks differ by decision state, never by hue alone: an accepted span keeps
 * its category fill and solid presence, a kept span fades back to plain text
 * with a dashed baseline, and an undecided span carries a warning outline.
 * Before this, accepted and rejected spans were painted identically.
 */
export const decisionMarkClass = {
  accepted: '',
  rejected: 'opacity-55',
  pseudonymised: 'ring-1 ring-info',
  pending: 'outline-2 outline-offset-1 outline-warning',
} satisfies Record<SpanDecisionState, string>

const dateFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
})
const dateTimeFormat = new Intl.DateTimeFormat('en-GB', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** One date format across the product: 26 Oct 2026, 14:32. */
export function formatDate(value: string) {
  return dateFormat.format(new Date(value))
}

export function formatDateTime(value: string) {
  return dateTimeFormat.format(new Date(value))
}

/**
 * The decision stores the deciding user's id and the API resolves the member
 * name beside it. A name that does not resolve (the account is no longer a
 * member) falls back to "another reviewer": showing the raw id would leak an
 * internal identifier, and inventing a name would falsify an audit record.
 */
function reviewerName(
  record: DecisionRecord,
  currentUserId: string | undefined,
) {
  if (currentUserId && record.decidedBy === currentUserId) return 'you'
  return record.decidedByName ?? 'another reviewer'
}

/** "Redacted by Priya Shah · 26 Oct 2026, 14:42", for one stored decision. */
export function decisionRecord(
  record: DecisionRecord,
  currentUserId: string | undefined,
) {
  const verb =
    record.decision === 'accept' || record.decision === 'override_redact'
      ? 'Redacted'
      : record.decision === 'pseudonymise'
        ? 'Pseudonymised'
        : 'Kept visible'
  return `${verb} by ${reviewerName(record, currentUserId)} · ${formatDateTime(record.decidedAt)}`
}

/** Counts per decision state, used by the filter tabs and the finalise gate. */
export function decisionCounts(spans: RedactionSpan[], decisions: Decisions) {
  const counts = {
    accepted: 0,
    rejected: 0,
    pseudonymised: 0,
    pending: 0,
  } satisfies Record<SpanDecisionState, number>
  for (const span of spans)
    counts[spanDecisionState(decisions[span.id]?.decision)] += 1
  return counts
}
