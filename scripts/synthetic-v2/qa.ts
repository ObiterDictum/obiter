import { supplementSpans } from '../../packages/redaction-policy/src/supplement'
import type { RedactionSpan } from '../../packages/redaction-policy/src/types'
import type { SyntheticDocument } from './types'

export type MechanicalQaMiss = {
  id: string
  category: string
  start: number
  end: number
  text: string
}

/**
 * Finds regex-detectable identifiers that the generator left unlabelled. This
 * is intentionally a QA signal, not a replacement for the labelled ground
 * truth: a supplement match can be a legal hard negative and needs review.
 */
export function supplementMisses(
  documents: SyntheticDocument[],
): MechanicalQaMiss[] {
  return documents.flatMap((document) =>
    supplementSpans(document.text)
      .filter(
        (candidate: RedactionSpan) =>
          !document.spans.some(
            (span) =>
              span.category === candidate.category &&
              span.start <= candidate.start &&
              candidate.end <= span.end,
          ),
      )
      .map((candidate: RedactionSpan) => ({
        id: document.id,
        category: candidate.category,
        start: candidate.start,
        end: candidate.end,
        text: candidate.text,
      })),
  )
}

export function qaSample(
  documents: SyntheticDocument[],
  minimumFraction = 0.1,
) {
  const count = Math.max(1, Math.ceil(documents.length * minimumFraction))
  return [...documents]
    .sort((left, right) => left.id.localeCompare(right.id))
    .filter((_, index) => index % Math.ceil(documents.length / count) === 0)
    .slice(0, count)
}
