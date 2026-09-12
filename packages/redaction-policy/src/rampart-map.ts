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
  // DATE/DOB are not in qarlus/rampart@c3221c5 id2label (re-verified 2 Sep 2026
  // against the cached model config). Kept so a later checkpoint that emits
  // them maps; v1 DOB detection is the cue-gated UK supplement.
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

/**
 * Model / product names the NER frequently tags as people. Exact token match
 * only — never drop multi-word person spans.
 */
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

/**
 * Honorifics and salutation words that sit immediately before a name and are
 * not themselves identifying.
 *
 * The NER does not tag these — verified against the model directly, which
 * returns only "Amara" for "Dear Ms Amara Okonkwo". They arrive because the
 * vendored classifier's `rescueCapitalizedParticles` widens person spans
 * outward across short capitalised tokens to recover genuine name particles
 * ("van", "de", "O'", initials). A title is short and capitalised and sits
 * exactly where a particle would, so it is swept in too.
 *
 * The trim lives here rather than in that denylist because
 * `@obiter/rampart-inference` is kept byte-faithful to the upstream tarball so
 * re-vendors produce reviewable diffs; a fix applied there would be lost on the
 * next re-vendor.
 *
 * Over-capture is the safe direction (it hides nothing that should be visible),
 * so this is a precision fix: a reviewer seeing "Dear Ms Amara" boxed as a name
 * has less reason to trust the spans that matter.
 */
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

/**
 * The subset that is never itself a name, so a span consisting of nothing but
 * this word can be discarded outright.
 *
 * `judge`, `justice`, `lord`, `lady` and `dame` are deliberately absent: they
 * are real surnames. Dropping a lone "Judge" would *under*-redact, which is the
 * unsafe direction, so those are only ever trimmed when a name follows them.
 */
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

/** A leading word plus the connector the classifier extended across. */
const LEADING_WORD_RE = /^(\p{L}[\p{L}\p{M}]*)(\.?)([ \t'’.-]+)/u
/** The whole remainder as a single word, with optional trailing punctuation. */
const SOLE_WORD_RE = /^(\p{L}[\p{L}\p{M}]*)[.,]?$/u

/**
 * Advance `start` past any leading honorifics or salutations, leaving the name
 * itself. Returns the original offset when nothing is trimmed, and never
 * advances past `end` — a span that is *only* a title collapses to empty and is
 * dropped by the caller rather than silently becoming a zero-width span.
 */
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
    // No connector left, so this is the final word of the span. Only collapse
    // it when the word is never a name in its own right ("Dear Sir").
    const sole = SOLE_WORD_RE.exec(remainder)
    if (sole && STANDALONE_TITLES.has(sole[1].toLowerCase())) offset = end
    break
  }
  return offset
}

function isDeniedPersonName(text: string) {
  const normalized = text.trim().toLowerCase()
  // A span that was nothing but a title trims to empty and identifies no one.
  if (normalized.length === 0) return true
  if (PERSON_NAME_DENYLIST.has(normalized)) return true
  // Heading-boundary glue that slipped past NER repair ("Jones\nLaw").
  if (/\n/.test(text)) return true
  return false
}

/**
 * Apply the person-name heuristics to each contributing detection *before* the
 * partial-overlap union, so a heuristic can only ever discard bytes from the
 * detection it judged.
 *
 * `trimLeadingTitles` and `isDeniedPersonName` are written for a span the model
 * returned as one detection. Once `mergeSpans` has unioned two detections, the
 * merged span covers bytes from both and either heuristic can discard the
 * other detection's characters:
 *
 *  - a title-shaped prefix can belong to a losing non-person detection (an
 *    address that starts "Dr"), and trimming the union advances past it;
 *  - a line break in one contributor makes the wider union trip the denial,
 *    dropping the contributor that does not contain it.
 *
 * Both losses are silent now that finalize derives span text from the source
 * instead of rejecting a mismatch (P2.39). Normalising first keeps every
 * heuristic's input a single detection, and the union then covers the bytes
 * each detection kept.
 */
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
    // The spread preserves every property of T; only `start` and `text` change,
    // and `RampartSpanInput` declares both, so the narrowing is sound.
    kept.push({ ...span, start, text: trimmed } as T)
  }
  return kept
}

/**
 * Map a merged Rampart span to an Obiter category.
 *
 * Person spans must already have been through {@link normalizePersonDetections};
 * applying the person heuristics to a merged span is P0.30. The caller
 * normalises the contributing detections, unions them, then calls this.
 */
export function mapRampartSpans(output: RampartOutput): RedactionSpan[] {
  return output.spans
    .filter((span) => span.start < span.end)
    .map((span, index) => {
      const label = span.label ?? span.entity
      if (!label || !labelMap[label]) {
        throw new Error(`Unrecognised Rampart label: ${label ?? '<missing>'}`)
      }
      const mapping = labelMap[label]
      // Always slice the source rather than trusting `span.text`. Upstream's
      // offset-changing merges (partial-overlap union in policy.mergeSpans)
      // widen start/end but keep the winner's text, so a carried `text` can
      // disagree with the offsets. `RedactionSpan.text` is a contract finalize
      // and the .docx burner enforce with text.slice(start, end) === text; the
      // source is authoritative here, so derive it instead of inheriting it.
      const text = output.text.slice(span.start, span.end)
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
