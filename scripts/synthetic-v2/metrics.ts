import type { SyntheticSpan } from './types'

export type SpanMetrics = {
  truePositive: number
  falsePositive: number
  falseNegative: number
  precision: number
  recall: number
  f1: number
}

export function hardNegativeFalsePositiveRate(
  totalNegatives: number,
  falsePositives: number,
) {
  if (
    !Number.isInteger(totalNegatives) ||
    totalNegatives < 0 ||
    !Number.isInteger(falsePositives) ||
    falsePositives < 0 ||
    falsePositives > totalNegatives
  )
    throw new Error('Invalid hard-negative counts')
  return totalNegatives === 0 ? 0 : falsePositives / totalNegatives
}

export type EvaluationReport = {
  overall: SpanMetrics
  macroF1: number
  byCategory: Record<string, SpanMetrics>
  roleConfusion: Record<string, number>
  hardNegativeFalsePositiveRate?: number
  documentExactMatchRate: number
}

type EvaluationDocument = {
  id: string
  gold: SyntheticSpan[]
  predicted: SyntheticSpan[]
}

function key(span: SyntheticSpan) {
  return `${span.category}:${span.start}:${span.end}:${span.text}`
}

function score(gold: SyntheticSpan[], predicted: SyntheticSpan[]): SpanMetrics {
  const expected = new Set(gold.map(key))
  const actual = new Set(predicted.map(key))
  const truePositive = [...actual].filter((value) => expected.has(value)).length
  const falsePositive = actual.size - truePositive
  const falseNegative = expected.size - truePositive
  const precision =
    truePositive + falsePositive === 0
      ? 1
      : truePositive / (truePositive + falsePositive)
  const recall =
    truePositive + falseNegative === 0
      ? 1
      : truePositive / (truePositive + falseNegative)
  return {
    truePositive,
    falsePositive,
    falseNegative,
    precision,
    recall,
    f1:
      precision + recall === 0
        ? 0
        : (2 * precision * recall) / (precision + recall),
  }
}

/** Entity-level exact-offset metrics for a frozen benchmark. */
export function evaluateSpans(
  documents: EvaluationDocument[],
): EvaluationReport {
  const categories = new Set(
    documents.flatMap((document) =>
      [...document.gold, ...document.predicted].map((span) => span.category),
    ),
  )
  const byCategory = Object.fromEntries(
    [...categories].map((category) => {
      const gold = documents.flatMap((document) =>
        document.gold
          .filter((span) => span.category === category)
          .map((span) => ({ ...span, text: `${document.id}:${span.text}` })),
      )
      const predicted = documents.flatMap((document) =>
        document.predicted
          .filter((span) => span.category === category)
          .map((span) => ({ ...span, text: `${document.id}:${span.text}` })),
      )
      return [category, score(gold, predicted)]
    }),
  )
  const roleCategories = new Set([
    'person_private',
    'person_protected',
    'person_professional',
  ])
  const roleConfusion: Record<string, number> = {}
  for (const document of documents) {
    for (const predicted of document.predicted) {
      if (!roleCategories.has(predicted.category)) continue
      const gold = document.gold.find(
        (span) => span.start === predicted.start && span.end === predicted.end,
      )
      if (
        gold &&
        gold.category !== predicted.category &&
        roleCategories.has(gold.category)
      )
        roleConfusion[`${gold.category}->${predicted.category}`] =
          (roleConfusion[`${gold.category}->${predicted.category}`] ?? 0) + 1
    }
  }
  const exact = documents.filter((document) => {
    const result = score(document.gold, document.predicted)
    return result.falsePositive === 0 && result.falseNegative === 0
  }).length
  const overallGold = documents.flatMap((document) =>
    document.gold.map((span) => ({
      ...span,
      text: `${document.id}:${span.text}`,
    })),
  )
  const overallPredicted = documents.flatMap((document) =>
    document.predicted.map((span) => ({
      ...span,
      text: `${document.id}:${span.text}`,
    })),
  )
  return {
    overall: score(overallGold, overallPredicted),
    macroF1:
      Object.values(byCategory).reduce(
        (total, metric) => total + metric.f1,
        0,
      ) / Math.max(1, Object.keys(byCategory).length),
    byCategory,
    roleConfusion,
    documentExactMatchRate:
      documents.length === 0 ? 1 : exact / documents.length,
  }
}
