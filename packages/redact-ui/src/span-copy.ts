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
  rampart_model: 'Found automatically',
  rampart_deterministic: 'Known pattern',
  uk_supplement: 'UK pattern',
} satisfies Record<SpanSource, string>

export const confidenceLabel = {
  high: 'High',
  medium: 'Medium',
  low: 'Low',
} satisfies Record<SpanConfidence, string>

export const confidenceExplanation = {
  high: 'the text matches what was looked for',
  medium: 'it partly matches, so read the surrounding text',
  low: 'a weak match — check it before deciding',
} satisfies Record<SpanConfidence, string>

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

export function spanDecisionState(
  decision: SpanDecision | undefined,
): SpanDecisionState {
  if (!decision) return 'pending'
  if (decision === 'accept' || decision === 'override_redact') return 'accepted'
  if (decision === 'pseudonymise') return 'pseudonymised'
  return 'rejected'
}

export function detectionSummary(bySource: {
  rampartModel: number
  rampartDeterministic: number
  ukSupplement: number
}) {
  const parts = [
    bySource.rampartModel > 0
      ? `${bySource.rampartModel} found automatically`
      : null,
    bySource.rampartDeterministic > 0
      ? `${bySource.rampartDeterministic} matched a known pattern`
      : null,
    bySource.ukSupplement > 0
      ? `${bySource.ukSupplement} matched a UK pattern`
      : null,
  ].filter((part): part is string => part !== null)
  return parts.length ? `Detection: ${parts.join(' · ')}.` : null
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

export function formatDate(value: string) {
  return dateFormat.format(new Date(value))
}

export function formatDateTime(value: string) {
  return dateTimeFormat.format(new Date(value))
}

function reviewerName(
  record: DecisionRecord,
  currentUserId: string | undefined,
) {
  if (currentUserId && record.decidedBy === currentUserId) return 'you'
  return record.decidedByName ?? 'another reviewer'
}

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
