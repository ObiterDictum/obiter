import { spanCategories, type SyntheticSpan } from './types'
import { MarkerValidationError, validateSpans } from './markers'

type AnnotationPayload = {
  id?: unknown
  spans?: unknown
}

/** Parse the model's structured annotation response against immutable source. */
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
  if (payload.id !== undefined && payload.id !== expectedId)
    throw new MarkerValidationError('Annotation response ID does not match')

  const categories = new Set<string>(spanCategories)
  const spans = payload.spans.map((candidate): SyntheticSpan => {
    if (!candidate || typeof candidate !== 'object')
      throw new MarkerValidationError('Annotation span is not an object')
    const span = candidate as Partial<SyntheticSpan>
    const { category, start, end } = span
    if (
      typeof category !== 'string' ||
      !categories.has(category) ||
      !Number.isInteger(start) ||
      !Number.isInteger(end)
    )
      throw new MarkerValidationError(
        'Annotation span has invalid category or offsets',
      )
    return {
      category: category as SyntheticSpan['category'],
      start: start as number,
      end: end as number,
      text: sourceText.slice(start as number, end as number),
    }
  })
  validateSpans(sourceText, spans)
  return spans
}
