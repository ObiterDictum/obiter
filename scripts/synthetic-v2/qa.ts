import { supplementSpans } from '../../packages/redaction-policy/src/supplement'
import type { RedactionSpan } from '../../packages/redaction-policy/src/types'
import type { SyntheticDocument } from './types'

export type JudgeVerdict = {
  id: string
  allProposedSpansCorrect: boolean
  hardNegativesCorrect: boolean
  obviousUnmarkedSpans: Array<{ category: string; text: string }>
  realismScore: number
  confidence: number
  rationale: string
}

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

export function judgePrompt(document: SyntheticDocument) {
  return `Independently audit this fictional UK legal redaction example. The text is plain text; proposed spans are supplied separately. Do not assume a span is correct merely because it is proposed. Professional names (solicitors, judges, counsel, experts, in-house counsel) should be detected as person_professional but normally kept by later policy. Private parties/witnesses are person_private; children, anonymity subjects, and family/medical/immigration/employment/criminal/safeguarding subjects are person_protected. Procedural dates, neutral citations, damages figures, and corporate registration numbers are hard negatives.\n\nText:\n${document.text}\n\nProposed spans:\n${JSON.stringify(document.spans)}\n\nReturn JSON only: {"id": string, "allProposedSpansCorrect": boolean, "hardNegativesCorrect": boolean, "obviousUnmarkedSpans": [{"category": string, "text": string}], "realismScore": 1|2|3|4|5, "confidence": number, "rationale": string}.`
}

export function parseJudgeVerdict(value: string, id: string): JudgeVerdict {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Judge returned invalid JSON for ${id}`)
  }
  if (!parsed || typeof parsed !== 'object')
    throw new Error(`Judge returned an invalid verdict for ${id}`)
  const verdict = parsed as Partial<JudgeVerdict>
  const realismScore = verdict.realismScore
  const confidence = verdict.confidence
  if (
    verdict.id !== id ||
    typeof verdict.allProposedSpansCorrect !== 'boolean' ||
    typeof verdict.hardNegativesCorrect !== 'boolean' ||
    !Array.isArray(verdict.obviousUnmarkedSpans) ||
    typeof realismScore !== 'number' ||
    !Number.isInteger(realismScore) ||
    realismScore < 1 ||
    realismScore > 5 ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1 ||
    typeof verdict.rationale !== 'string'
  )
    throw new Error(`Judge returned an invalid verdict for ${id}`)
  return verdict as JudgeVerdict
}

export function requiresRegeneration(verdict: JudgeVerdict) {
  return (
    !verdict.allProposedSpansCorrect ||
    !verdict.hardNegativesCorrect ||
    verdict.obviousUnmarkedSpans.length > 0 ||
    verdict.realismScore < 4 ||
    verdict.confidence < 0.8
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
