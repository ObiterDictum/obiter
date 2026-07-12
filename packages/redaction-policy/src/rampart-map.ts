import type { RedactionSpan, SpanCategory, SpanSource } from './types'
import { suggestedAction } from './merge'

export interface RampartSpanInput {
  start: number
  end: number
  text?: string
  label?: string
  entity?: string
  score?: number
}

export interface RampartOutput {
  text: string
  spans: RampartSpanInput[]
}

const labelMap: Record<
  string,
  { category: SpanCategory; source: SpanSource; dateOfBirth?: boolean }
> = {
  GIVEN_NAME: { category: 'person_name', source: 'rampart_model' },
  SURNAME: { category: 'person_name', source: 'rampart_model' },
  PHONE: { category: 'phone', source: 'rampart_model' },
  PASSPORT: { category: 'passport', source: 'rampart_model' },
  DRIVERS_LICENSE: { category: 'drivers_license', source: 'rampart_model' },
  // DATE/DOB are NOT emitted by the base Rampart model (label space verified
  // against the model config, July 2026 — see PRD 1, Rampart Spike Results).
  // Retained so a future fine-tuned checkpoint emitting them maps correctly;
  // v1 date/DOB detection comes from the UK supplement instead.
  DATE: { category: 'date', source: 'rampart_model' },
  DOB: { category: 'date', source: 'rampart_model', dateOfBirth: true },
  BUILDING_NUMBER: { category: 'address', source: 'rampart_model' },
  STREET_NAME: { category: 'address', source: 'rampart_model' },
  SECONDARY_ADDRESS: { category: 'address', source: 'rampart_model' },
  CITY: { category: 'address', source: 'rampart_model' },
  STATE: { category: 'address', source: 'rampart_model' },
  ZIP_CODE: { category: 'address', source: 'rampart_model' },
  EMAIL: { category: 'email', source: 'rampart_deterministic' },
  URL: { category: 'url', source: 'rampart_deterministic' },
  IP_ADDRESS: { category: 'ip_address', source: 'rampart_deterministic' },
  CREDIT_CARD: { category: 'account_number', source: 'rampart_deterministic' },
  BANK_ACCOUNT: { category: 'account_number', source: 'rampart_model' },
  ROUTING_NUMBER: { category: 'account_number', source: 'rampart_model' },
  SSN: { category: 'government_id', source: 'rampart_deterministic' },
  GOVERNMENT_ID: { category: 'government_id', source: 'rampart_model' },
  TAX_ID: { category: 'government_id', source: 'rampart_model' },
}

function confidence(score: number | undefined): RedactionSpan['confidence'] {
  if (score === undefined || score >= 0.85) return 'high'
  if (score >= 0.6) return 'medium'
  return 'low'
}

export function mapRampartSpans(output: RampartOutput): RedactionSpan[] {
  return output.spans
    .filter((span) => span.start < span.end)
    .map((span, index) => {
      const label = span.label ?? span.entity
      if (!label || !labelMap[label]) {
        throw new Error(`Unrecognised Rampart label: ${label ?? '<missing>'}`)
      }
      const mapping = labelMap[label]
      const text = span.text ?? output.text.slice(span.start, span.end)
      return {
        id: `span_rampart_${span.start}_${index}`,
        start: span.start,
        end: span.end,
        text,
        category: mapping.category,
        source: mapping.source,
        confidence: confidence(span.score),
        suggestion: suggestedAction(mapping.category, mapping.dateOfBirth),
      }
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)
}
