import { spanCategories, type SyntheticSpan } from './types'
import { MarkerValidationError, validateSpans } from './markers'

type AnnotationPayload = { id?: unknown; spans?: unknown }
type AnnotationCandidate = {
  category?: unknown
  startToken?: unknown
  endToken?: unknown
}

export type SourceToken = {
  index: number
  start: number
  end: number
  text: string
}

/** Stable lexical/punctuation tokens; whitespace between selected tokens is
 * included locally when constructing the immutable source slice. */
export function sourceTokens(source: string): SourceToken[] {
  return [
    ...source.matchAll(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*|[^\s]/gu),
  ].map((match, index) => ({
    index,
    start: match.index,
    end: match.index + match[0].length,
    text: match[0],
  }))
}

/**
 * Resolve model-provided quotes against immutable source text. Offsets are
 * checked when supplied, but never trusted as the sole statement of intent.
 */
export function parseAnnotationResponse(
  value: string,
  sourceText: string,
  expectedId: string,
): SyntheticSpan[] {
  let payload: AnnotationPayload
  try {
    payload = JSON.parse(value) as AnnotationPayload
  } catch {
    throw new MarkerValidationError('Annotation response is not valid JSON')
  }
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.spans))
    throw new MarkerValidationError('Annotation response must contain spans')
  if (payload.id !== expectedId)
    throw new MarkerValidationError('Annotation response ID does not match')

  const categories = new Set<string>(spanCategories)
  const tokens = sourceTokens(sourceText)
  const spans = payload.spans.map((value): SyntheticSpan => {
    if (!value || typeof value !== 'object')
      throw new MarkerValidationError('Annotation span is not an object')
    const { category, startToken, endToken } = value as AnnotationCandidate
    if (
      typeof category !== 'string' ||
      !categories.has(category) ||
      !Number.isInteger(startToken) ||
      !Number.isInteger(endToken) ||
      (startToken as number) < 0 ||
      (endToken as number) <= (startToken as number) ||
      (endToken as number) > tokens.length
    )
      throw new MarkerValidationError(
        'Annotation span requires category and a valid token range',
      )
    const first = tokens[startToken as number]!
    const last = tokens[(endToken as number) - 1]!
    return {
      category: category as SyntheticSpan['category'],
      start: first.start,
      end: last.end,
      text: sourceText.slice(first.start, last.end),
    }
  })
  const canonical = canonicalizePersonOverlaps(spans)
  const ordered = [...canonical].sort(
    (left, right) => left.start - right.start || left.end - right.end,
  )
  for (let index = 1; index < ordered.length; index++) {
    const previous = ordered[index - 1]!
    const current = ordered[index]!
    if (current.start < previous.end)
      throw new MarkerValidationError(
        `Overlapping or nested spans: ${previous.category} ${JSON.stringify(previous.text)} conflicts with ${current.category} ${JSON.stringify(current.text)}`,
      )
  }
  validateSpans(sourceText, canonical)
  return canonical
}

const personCategoryPriority: Partial<
  Record<SyntheticSpan['category'], number>
> = {
  person_private: 1,
  person_professional: 2,
  person_protected: 3,
}

/**
 * Models sometimes emit a full person mention and a nested name variant, or
 * classify the same mention under multiple person roles. These spans describe
 * one source entity, so retain the enclosing mention and the most protective
 * role. Other cross-category overlaps remain hard failures.
 */
function canonicalizePersonOverlaps(spans: SyntheticSpan[]) {
  const ordered = [...spans].sort(
    (left, right) => left.start - right.start || right.end - left.end,
  )
  const canonical: SyntheticSpan[] = []
  for (const span of ordered) {
    const previous = canonical.at(-1)
    if (!previous || span.start >= previous.end) {
      canonical.push(span)
      continue
    }
    const sameCategory = previous.category === span.category
    const exactDuplicate =
      sameCategory &&
      previous.start === span.start &&
      previous.end === span.end &&
      previous.text === span.text
    if (exactDuplicate) continue
    const bothPeople =
      personCategoryPriority[previous.category] !== undefined &&
      personCategoryPriority[span.category] !== undefined
    const nested = span.end <= previous.end
    if (!nested || !bothPeople) {
      canonical.push(span)
      continue
    }
    if (
      personCategoryPriority[span.category]! >
      personCategoryPriority[previous.category]!
    )
      canonical[canonical.length - 1] = {
        ...previous,
        category: span.category,
      }
  }
  return canonical
}

/** Resolve a model occurrence while tolerating entity-count semantics only
 * when an exact quote has one unambiguous source location. */
export function resolveExactQuoteOccurrence(
  source: string,
  quote: string,
  occurrence: number,
) {
  const matches = occurrences(source, quote)
  return (
    matches[occurrence - 1] ?? (matches.length === 1 ? matches[0] : undefined)
  )
}

function occurrences(source: string, quote: string) {
  const found: number[] = []
  for (
    let index = source.indexOf(quote);
    index !== -1;
    index = source.indexOf(quote, index + 1)
  )
    found.push(index)
  return found
}
