import { spanCategories, type SyntheticSpan } from './types'

const open = '⟦'
const close = '⟦/⟧'
const labels = new Set<string>(spanCategories)

export class MarkerValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MarkerValidationError'
  }
}

/** Converts ⟦category⟧value⟦/⟧ markers into plain text and exact offsets. */
export function stripMarkers(markedText: string): {
  text: string
  spans: SyntheticSpan[]
} {
  let sourceIndex = 0
  let text = ''
  const spans: SyntheticSpan[] = []

  while (sourceIndex < markedText.length) {
    const nextOpen = markedText.indexOf(open, sourceIndex)
    if (nextOpen === -1) {
      const tail = markedText.slice(sourceIndex)
      if (tail.includes(close))
        throw new MarkerValidationError('Dangling closing marker')
      text += tail
      break
    }

    const before = markedText.slice(sourceIndex, nextOpen)
    if (before.includes(close))
      throw new MarkerValidationError('Dangling closing marker')
    text += before

    const labelEnd = markedText.indexOf('⟧', nextOpen + open.length)
    if (labelEnd === -1)
      throw new MarkerValidationError('Unterminated opening marker')
    const category = markedText.slice(nextOpen + open.length, labelEnd)
    if (!labels.has(category))
      throw new MarkerValidationError(`Unknown marker label: ${category}`)

    const valueStart = labelEnd + 1
    const closeIndex = markedText.indexOf(close, valueStart)
    if (closeIndex === -1)
      throw new MarkerValidationError('Unterminated span marker')
    const value = markedText.slice(valueStart, closeIndex)
    if (value.length === 0) throw new MarkerValidationError('Empty marked span')
    if (value.includes(open) || value.includes(close))
      throw new MarkerValidationError('Nested marker')

    const start = text.length
    text += value
    const end = text.length
    spans.push({
      category: category as SyntheticSpan['category'],
      start,
      end,
      text: value,
    })
    sourceIndex = closeIndex + close.length
  }

  if (text.includes(open) || text.includes(close))
    throw new MarkerValidationError('Unresolved marker')
  validateSpans(text, spans)
  return { text, spans }
}

export function validateSpans(text: string, spans: SyntheticSpan[]) {
  let previousEnd = 0
  for (const span of [...spans].sort(
    (left, right) => left.start - right.start,
  )) {
    if (!labels.has(span.category))
      throw new MarkerValidationError(`Unknown span label: ${span.category}`)
    if (
      span.start < 0 ||
      span.end <= span.start ||
      span.end > text.length ||
      text.slice(span.start, span.end) !== span.text
    )
      throw new MarkerValidationError(
        `Offset round-trip failed for ${span.category}`,
      )
    if (span.start < previousEnd)
      throw new MarkerValidationError('Overlapping or nested spans')
    previousEnd = span.end
  }
}
