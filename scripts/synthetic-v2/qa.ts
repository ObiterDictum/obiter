import { supplementSpans } from '../../packages/redaction-policy/src/supplement'
import type { RedactionSpan } from '../../packages/redaction-policy/src/types'
import type { JudgeAdapter, RequestTelemetry, SyntheticDocument } from './types'

export type JudgeVerdict = {
  id: string
  allProposedSpansCorrect: boolean
  hardNegativesCorrect: boolean
  obviousUnmarkedSpans: Array<{ category: string; text: string }>
  realismScore: number
  confidence: number
  rationale: string
}

export type QaEvidence = {
  primary: JudgeVerdict
  dispute?: JudgeVerdict
  primaryTelemetry?: RequestTelemetry
  disputeTelemetry?: RequestTelemetry
  escalationReasons: string[]
  accepted: boolean
}

export type MechanicalQaMiss = {
  id: string
  category: string
  start: number
  end: number
  text: string
}

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
  return `Independently audit this fictional UK legal redaction example. The text is plain text; proposed spans are supplied separately. Do not assume a span is correct merely because it is proposed. Professional names (solicitors, judges, counsel, experts, in-house counsel) should be detected as person_professional but normally kept by later policy. Private parties/witnesses are person_private; children, anonymity subjects, and people in family, medical, immigration, employment, criminal, or safeguarding contexts are person_protected. Procedural dates, neutral citations, damages figures, and corporate registration numbers are hard negatives.\n\nText:\n${document.text}\n\nProposed spans:\n${JSON.stringify(document.spans)}\n\nHard-negative assertions:\n${JSON.stringify(document.hardNegatives ?? [])}\n\nReturn JSON only: {"id": string, "allProposedSpansCorrect": boolean, "hardNegativesCorrect": boolean, "obviousUnmarkedSpans": [{"category": string, "text": string}], "realismScore": 1|2|3|4|5, "confidence": number, "rationale": string}.`
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
  if (
    verdict.id !== id ||
    typeof verdict.allProposedSpansCorrect !== 'boolean' ||
    typeof verdict.hardNegativesCorrect !== 'boolean' ||
    !Array.isArray(verdict.obviousUnmarkedSpans) ||
    typeof verdict.realismScore !== 'number' ||
    !Number.isInteger(verdict.realismScore) ||
    verdict.realismScore < 1 ||
    verdict.realismScore > 5 ||
    typeof verdict.confidence !== 'number' ||
    verdict.confidence < 0 ||
    verdict.confidence > 1 ||
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

export function escalationReasons(
  document: SyntheticDocument,
  primary: JudgeVerdict,
) {
  const reasons: string[] = []
  if (requiresRegeneration(primary)) reasons.push('primary_rejection')
  if (primary.confidence < 0.9) reasons.push('low_confidence')
  if (document.spans.some((span) => span.category === 'person_protected'))
    reasons.push('protected_person')
  if (
    (document.hardNegatives?.length ?? 0) > 0 ||
    !primary.hardNegativesCorrect
  )
    reasons.push('hard_negative')
  return reasons
}

/** Runs primary review, then independent adjudication for every policy escalation. */
export async function reviewDocuments(
  documents: SyntheticDocument[],
  primaryJudge: JudgeAdapter,
  disputeJudge: JudgeAdapter,
  signal?: AbortSignal,
): Promise<Map<string, QaEvidence>> {
  const primaryResponses = await primaryJudge.judge(documents, signal)
  const primary = new Map(
    primaryResponses.map((response) => [
      response.id,
      {
        verdict: parseJudgeVerdict(response.verdict, response.id),
        telemetry: response.telemetry,
      },
    ]),
  )
  if (primary.size !== documents.length)
    throw new Error('Primary QA omitted one or more documents')
  const escalated = documents.filter(
    (document) =>
      escalationReasons(document, primary.get(document.id)!.verdict).length > 0,
  )
  const disputes = escalated.length
    ? await disputeJudge.judge(escalated, signal)
    : []
  const dispute = new Map(
    disputes.map((response) => [
      response.id,
      {
        verdict: parseJudgeVerdict(response.verdict, response.id),
        telemetry: response.telemetry,
      },
    ]),
  )
  if (dispute.size !== escalated.length)
    throw new Error('Second judge omitted an escalated document')
  return new Map(
    documents.map((document) => {
      const first = primary.get(document.id)!
      const reasons = escalationReasons(document, first.verdict)
      const second = dispute.get(document.id)
      const accepted =
        !requiresRegeneration(first.verdict) &&
        (!second || !requiresRegeneration(second.verdict))
      return [
        document.id,
        {
          primary: first.verdict,
          dispute: second?.verdict,
          primaryTelemetry: first.telemetry,
          disputeTelemetry: second?.telemetry,
          escalationReasons: reasons,
          accepted,
        },
      ]
    }),
  )
}

/** Deterministic strata-aware audit selection; no document can satisfy two slots. */
export function qaSample(
  documents: SyntheticDocument[],
  minimumFraction = 0.15,
) {
  const count = Math.max(1, Math.ceil(documents.length * minimumFraction))
  const ordered = [...documents].sort((left, right) =>
    left.id.localeCompare(right.id),
  )
  const strata = [
    (document: SyntheticDocument) =>
      document.spans.some((span) => span.category === 'person_protected'),
    (document: SyntheticDocument) => (document.hardNegatives?.length ?? 0) > 0,
    (document: SyntheticDocument) =>
      document.spans.some((span) => span.category === 'person_professional'),
  ]
  const chosen: SyntheticDocument[] = []
  for (const matches of strata) {
    const document = ordered.find(
      (candidate) =>
        matches(candidate) &&
        !chosen.some((entry) => entry.id === candidate.id),
    )
    if (document) chosen.push(document)
  }
  for (const document of ordered)
    if (
      chosen.length < count &&
      !chosen.some((entry) => entry.id === document.id)
    )
      chosen.push(document)
  return chosen.slice(
    0,
    Math.max(count, Math.min(strata.length, ordered.length)),
  )
}
