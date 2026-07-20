import { spanCategories, type SyntheticSpan } from './types'
import { MarkerValidationError, validateSpans } from './markers'

type AnnotationPayload = { id?: unknown; spans?: unknown }
type AnnotationCandidate = {
  category?: unknown
  quote?: unknown
  occurrence?: unknown
  start?: unknown
  end?: unknown
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
  const spans = payload.spans.map((value): SyntheticSpan => {
    if (!value || typeof value !== 'object')
      throw new MarkerValidationError('Annotation span is not an object')
    const { category, quote, occurrence, start, end } =
      value as AnnotationCandidate
    if (
      typeof category !== 'string' ||
      !categories.has(category) ||
      typeof quote !== 'string' ||
      quote.length === 0 ||
      !Number.isInteger(occurrence) ||
      (occurrence as number) < 1
    )
      throw new MarkerValidationError(
        'Annotation span requires category, quote, and occurrence',
      )
    const matches = occurrences(sourceText, quote)
    const resolved = matches[(occurrence as number) - 1]
    if (resolved === undefined)
      throw new MarkerValidationError(
        'Annotation quote occurrence is not in source',
      )
    if (start !== undefined || end !== undefined) {
      if (
        !Number.isInteger(start) ||
        !Number.isInteger(end) ||
        start !== resolved ||
        end !== resolved + quote.length
      )
        throw new MarkerValidationError(
          'Annotation offsets do not match quote occurrence',
        )
    }
    return {
      category: category as SyntheticSpan['category'],
      start: resolved,
      end: resolved + quote.length,
      text: quote,
    }
  })
  validateSpans(sourceText, spans)
  return spans
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
