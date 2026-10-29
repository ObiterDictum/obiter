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

interface RampartLabelMap {
  [label: string]: {
    category: SpanCategory
    source: SpanSource
    dateOfBirth?: boolean
  }
}

const labelMap: RampartLabelMap = {
  GIVEN_NAME: { category: 'person_name', source: 'rampart_model' },
  SURNAME: { category: 'person_name', source: 'rampart_model' },
  PHONE: { category: 'phone', source: 'rampart_model' },
  PASSPORT: { category: 'passport', source: 'rampart_model' },
  DRIVERS_LICENSE: { category: 'drivers_license', source: 'rampart_model' },
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

const PERSON_NAME_DENYLIST = new Set([
  'kimi',
  'gpt',
  'chatgpt',
  'claude',
  'gemini',
  'grok',
  'qwen',
  'deepseek',
  'openai',
  'anthropic',
  'mistral',
  'llama',
  'copilot',
])

const PERSON_NAME_TITLES = new Set([
  'dear',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'professor',
  'sir',
  'madam',
  'lord',
  'lady',
  'dame',
  'rev',
  'hon',
  'judge',
  'justice',
])

const STANDALONE_TITLES = new Set([
  'dear',
  'mr',
  'mrs',
  'ms',
  'miss',
  'mx',
  'dr',
  'prof',
  'professor',
  'sir',
  'madam',
  'rev',
  'hon',
])

const LEADING_WORD_RE = /^(\p{L}[\p{L}\p{M}]*)(\.?)([ \t'’.-]+)/u
const SOLE_WORD_RE = /^(\p{L}[\p{L}\p{M}]*)[.,]?$/u

function trimLeadingTitles(text: string, start: number, end: number): number {
  let offset = start
  while (offset < end) {
    const remainder = text.slice(offset, end)
    const match = LEADING_WORD_RE.exec(remainder)
    if (match) {
      if (!PERSON_NAME_TITLES.has(match[1].toLowerCase())) break
      offset += match[0].length
      continue
    }
    const sole = SOLE_WORD_RE.exec(remainder)
    if (sole && STANDALONE_TITLES.has(sole[1].toLowerCase())) offset = end
    break
  }
  return offset
}

function isDeniedPersonName(text: string) {
  const normalized = text.trim().toLowerCase()
  if (normalized.length === 0) return true
  if (PERSON_NAME_DENYLIST.has(normalized)) return true
  if (/\n/.test(text)) return true
  return false
}

export function normalizePersonDetections<T extends RampartSpanInput>(
  text: string,
  spans: readonly T[],
): T[] {
  const kept: T[] = []
  for (const span of spans) {
    const label = span.label ?? span.entity
    if (label === undefined || labelMap[label]?.category !== 'person_name') {
      kept.push(span)
      continue
    }
    const start = trimLeadingTitles(text, span.start, span.end)
    const trimmed = text.slice(start, span.end)
    if (isDeniedPersonName(trimmed)) continue
    // SAFETY: the spread preserves every property of T and only `start` and `text` change, both declared on the RampartSpanInput bound established by the generic constraint above, so the result is still a T.
    kept.push({ ...span, start, text: trimmed } as T)
  }
  return kept
}

export function mapRampartSpans(output: RampartOutput): RedactionSpan[] {
  return output.spans
    .filter((span) => span.start < span.end)
    .map((span, index) =>
      mapRampartSpan(output.text, span, `span_rampart_${span.start}_${index}`),
    )
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

function mapRampartSpan(
  text: string,
  span: RampartSpanInput,
  id: string,
): RedactionSpan {
  const label = span.label ?? span.entity
  if (!label || !labelMap[label]) {
    throw new Error(`Unrecognised Rampart label: ${label ?? '<missing>'}`)
  }
  const mapping = labelMap[label]
  const sliced = text.slice(span.start, span.end)
  return {
    id,
    start: span.start,
    end: span.end,
    text: sliced,
    category: mapping.category,
    source: mapping.source,
    confidence: confidence(span.score),
    suggestion: suggestedAction(mapping.category, mapping.dateOfBirth),
  }
}

export function reconcileRampartSpans(
  text: string,
  spans: readonly RampartSpanInput[],
): RedactionSpan[] {
  const contributors = spans
    .filter((span) => span.start < span.end)
    .map((span, index) => ({
      span,
      mapped: mapRampartSpan(text, span, `span_rampart_${span.start}_${index}`),
    }))
    .sort(
      (left, right) =>
        left.mapped.start - right.mapped.start ||
        left.mapped.end - right.mapped.end,
    )

  const clusters: Contributor[][] = []
  let coveredTo = -1
  for (const contributor of contributors) {
    const current = clusters[clusters.length - 1]
    if (current !== undefined && contributor.mapped.start < coveredTo) {
      current.push(contributor)
      coveredTo = Math.max(coveredTo, contributor.mapped.end)
      continue
    }
    clusters.push([contributor])
    coveredTo = contributor.mapped.end
  }

  return clusters
    .map((cluster, index) => {
      const winner = cluster.reduce((best, candidate) =>
        comparesAbove(candidate, best) > 0 ? candidate : best,
      )
      const start = Math.min(...cluster.map((c) => c.mapped.start))
      const end = Math.max(...cluster.map((c) => c.mapped.end))
      const redacts = cluster.some((c) => c.mapped.suggestion === 'redact')
      return {
        ...winner.mapped,
        id: `span_rampart_${start}_${index}`,
        start,
        end,
        text: text.slice(start, end),
        suggestion: redacts ? ('redact' as const) : winner.mapped.suggestion,
      }
    })
    .sort((left, right) => left.start - right.start || left.end - right.end)
}

interface Contributor {
  readonly span: RampartSpanInput
  readonly mapped: RedactionSpan
}

function comparesAbove(candidate: Contributor, incumbent: Contributor): number {
  const candidateScore = normalizedScore(candidate.span.score)
  const incumbentScore = normalizedScore(incumbent.span.score)
  if (candidateScore !== incumbentScore) return candidateScore - incumbentScore
  const left = candidate.mapped
  const right = incumbent.mapped
  const leftLength = left.end - left.start
  const rightLength = right.end - right.start
  if (leftLength !== rightLength) return leftLength - rightLength
  if (left.source !== right.source)
    return left.source === 'rampart_deterministic' ? 1 : -1
  return left.category < right.category
    ? -1
    : left.category > right.category
      ? 1
      : 0
}

function normalizedScore(score: number | undefined): number {
  return typeof score === 'number' && Number.isFinite(score) ? score : 0
}
