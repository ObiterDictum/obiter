import { supplementSpans } from '../../packages/redaction-policy/src/supplement'
import type { RedactionSpan } from '../../packages/redaction-policy/src/types'
import { resolveExactQuoteOccurrence } from './annotations'
import { canonicalHash } from './governance'
import { validateSpans } from './markers'
import {
  spanCategories,
  type JudgeAdapter,
  type RequestTelemetry,
  type SyntheticDocument,
  type SyntheticSpan,
} from './types'

export type HardNegativeJudgeResult = {
  assertionId: string
  correctlyUnlabelled: boolean
}

export type QuoteOccurrenceSpan = {
  category: SyntheticSpan['category']
  quote: string
  occurrence: number
}

export type IndependentJudgeReference = {
  id: string
  referenceSpans: QuoteOccurrenceSpan[]
  realismScore: number
  confidence: number
  rationale: string
}

/** A judge's independently produced reference, never a copy of the labeler output. */
export type JudgeVerdict = {
  id: string
  allProposedSpansCorrect: boolean
  hardNegativesCorrect: boolean
  hardNegativeAssertions: HardNegativeJudgeResult[]
  referenceSpans: SyntheticSpan[]
  obviousUnmarkedSpans: Array<{ category: string; text: string }>
  realismScore: number
  confidence: number
  rationale: string
}

export type HumanAdjudication = {
  id: string
  decision: 'approved' | 'rejected'
  reviewer: string
  adjudicatedAt: string
  rationale: string
  referenceSpans: SyntheticSpan[]
  /** Binds this disposition to immutable source and both judge references. */
  evidenceHash: string
}

export type QaOutcome =
  | 'accepted'
  | 'repair_required'
  | 'human_adjudication_required'
  | 'human_rejected'

export type QaEvidence = {
  primary: JudgeVerdict
  dispute?: JudgeVerdict
  human?: HumanAdjudication
  primaryTelemetry?: RequestTelemetry
  primaryRetryTelemetry?: RequestTelemetry[]
  disputeTelemetry?: RequestTelemetry
  disputeRetryTelemetry?: RequestTelemetry[]
  escalationReasons: string[]
  outcome: QaOutcome
  /** Retained for artifact consumers; never true for an unresolved dispute. */
  accepted: boolean
  adjudicatedReference?: {
    source: 'primary_judge' | 'independent_judge_agreement' | 'human'
    spans: SyntheticSpan[]
  }
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

export function judgePrompt(
  document: SyntheticDocument,
  repairFeedback?: string,
) {
  const repair = repairFeedback
    ? `\n\nVALIDATION FEEDBACK — return a complete replacement reference and fix this failure: ${repairFeedback}`
    : ''
  return `Independently produce an exhaustive reference annotation for this fictional UK legal text. You receive only source text and policy, never proposed annotations. Professional names (solicitors, judges, counsel, experts, in-house counsel) are person_professional; private parties/witnesses are person_private; children, anonymity subjects, and people in family, medical, immigration, employment, criminal, or safeguarding contexts are person_protected. Do not label procedural dates, neutral citations, damages figures, or corporate registration numbers. For each span provide its exact quote and one-based occurrence among identical quotes; do not calculate character offsets.\n\nText:\n${document.text}${repair}\n\nReturn JSON only: {"id": string, "referenceSpans": [{"category": string, "quote": string, "occurrence": integer}], "realismScore": 1|2|3|4|5, "confidence": number, "rationale": string}.`
}

export function parseJudgeVerdict(
  value: string,
  id: string,
  document?: SyntheticDocument,
): JudgeVerdict {
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
    !Array.isArray(verdict.hardNegativeAssertions) ||
    !Array.isArray(verdict.referenceSpans) ||
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
  if (!verdict.hardNegativeAssertions.every(isHardNegativeJudgeResult))
    throw new Error(`Judge returned invalid hard-negative evidence for ${id}`)
  if (!verdict.referenceSpans.every(isSyntheticSpan))
    throw new Error(`Judge returned invalid reference spans for ${id}`)
  if (!verdict.obviousUnmarkedSpans.every(isObviousMiss))
    throw new Error(`Judge returned invalid unmarked-span evidence for ${id}`)
  const complete = verdict as JudgeVerdict
  if (document) validateJudgeReference(complete, document)
  return complete
}

export function parseIndependentJudgeReference(
  value: string,
  id: string,
  document: SyntheticDocument,
): IndependentJudgeReference {
  let parsed: unknown
  try {
    parsed = JSON.parse(value)
  } catch {
    throw new Error(`Judge returned invalid JSON for ${id}`)
  }
  if (!parsed || typeof parsed !== 'object')
    throw new Error(`Judge returned an invalid reference for ${id}`)
  const reference = parsed as Partial<IndependentJudgeReference>
  const { referenceSpans, realismScore, confidence, rationale } = reference
  if (
    reference.id !== id ||
    !Array.isArray(referenceSpans) ||
    typeof realismScore !== 'number' ||
    !Number.isInteger(realismScore) ||
    realismScore < 1 ||
    realismScore > 5 ||
    typeof confidence !== 'number' ||
    confidence < 0 ||
    confidence > 1 ||
    typeof rationale !== 'string'
  )
    throw new Error(`Judge returned an invalid reference for ${id}`)
  const spans = referenceSpans.map((span) =>
    resolveQuoteOccurrence(document.text, span),
  )
  validateSpans(document.text, spans)
  return {
    id,
    referenceSpans: referenceSpans as QuoteOccurrenceSpan[],
    realismScore,
    confidence,
    rationale,
  }
}

export function evaluateIndependentReference(
  document: SyntheticDocument,
  reference: IndependentJudgeReference,
): JudgeVerdict {
  const referenceSpans = reference.referenceSpans.map((span) =>
    resolveQuoteOccurrence(document.text, span),
  )
  const same =
    canonicalHash(sortedSpans(referenceSpans)) ===
    canonicalHash(sortedSpans(document.spans))
  const hardNegativeAssertions = (document.hardNegatives ?? []).map(
    (assertion) => {
      const starts = occurrences(document.text, assertion.quote)
      const start = starts[assertion.occurrence - 1]
      const end = start === undefined ? -1 : start + assertion.quote.length
      return {
        assertionId: assertion.id,
        correctlyUnlabelled:
          starts.length === assertion.expectedCount &&
          start !== undefined &&
          !document.spans.some(
            (span) =>
              assertion.mustNotOverlap.includes(span.category) &&
              span.start < end &&
              start < span.end,
          ),
      }
    },
  )
  const hardNegativesCorrect = hardNegativeAssertions.every(
    (assertion) => assertion.correctlyUnlabelled,
  )
  return {
    id: document.id,
    allProposedSpansCorrect: same,
    hardNegativesCorrect,
    hardNegativeAssertions,
    referenceSpans,
    obviousUnmarkedSpans: referenceSpans
      .filter(
        (referenceSpan) =>
          !document.spans.some(
            (span) =>
              span.category === referenceSpan.category &&
              span.start === referenceSpan.start &&
              span.end === referenceSpan.end,
          ),
      )
      .map(({ category, text }) => ({ category, text })),
    realismScore: reference.realismScore,
    confidence: reference.confidence,
    rationale: reference.rationale,
  }
}

function resolveQuoteOccurrence(text: string, value: unknown): SyntheticSpan {
  if (!value || typeof value !== 'object')
    throw new Error('Judge reference span is invalid')
  const span = value as Partial<QuoteOccurrenceSpan>
  const { category, quote, occurrence } = span
  if (
    !spanCategories.includes(category as SyntheticSpan['category']) ||
    typeof quote !== 'string' ||
    !quote.length ||
    typeof occurrence !== 'number' ||
    !Number.isInteger(occurrence) ||
    occurrence < 1
  )
    throw new Error('Judge reference requires category, quote, and occurrence')
  const start = resolveExactQuoteOccurrence(text, quote, occurrence)
  if (start === undefined)
    throw new Error('Judge reference quote occurrence is absent or ambiguous')
  return {
    category: category as SyntheticSpan['category'],
    start,
    end: start + quote.length,
    text: quote,
  }
}

function occurrences(text: string, quote: string) {
  const starts: number[] = []
  for (
    let start = text.indexOf(quote);
    start !== -1;
    start = text.indexOf(quote, start + 1)
  )
    starts.push(start)
  return starts
}

function isHardNegativeJudgeResult(
  value: unknown,
): value is HardNegativeJudgeResult {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as HardNegativeJudgeResult).assertionId === 'string' &&
    typeof (value as HardNegativeJudgeResult).correctlyUnlabelled === 'boolean'
  )
}
function isSyntheticSpan(value: unknown): value is SyntheticSpan {
  if (!value || typeof value !== 'object') return false
  const span = value as SyntheticSpan
  return (
    spanCategories.includes(span.category) &&
    Number.isInteger(span.start) &&
    Number.isInteger(span.end) &&
    span.start >= 0 &&
    span.end >= span.start &&
    typeof span.text === 'string'
  )
}
function isObviousMiss(value: unknown) {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    typeof (value as { category?: unknown }).category === 'string' &&
    typeof (value as { text?: unknown }).text === 'string'
  )
}
function validateJudgeReference(
  verdict: JudgeVerdict,
  document: SyntheticDocument,
) {
  const expectedAssertions = new Set(
    (document.hardNegatives ?? []).map((assertion) => assertion.id),
  )
  const reportedAssertions = new Set(
    verdict.hardNegativeAssertions.map((result) => result.assertionId),
  )
  if (
    expectedAssertions.size !== reportedAssertions.size ||
    [...expectedAssertions].some((id) => !reportedAssertions.has(id))
  )
    throw new Error(`Judge omitted hard-negative evidence for ${document.id}`)
  for (const span of verdict.referenceSpans) {
    if (document.text.slice(span.start, span.end) !== span.text)
      throw new Error(
        `Judge reference offset does not match source for ${document.id}`,
      )
  }
  const ordered = [...verdict.referenceSpans].sort(
    (left, right) => left.start - right.start,
  )
  if (
    ordered.some(
      (span, index) => index > 0 && ordered[index - 1]!.end > span.start,
    )
  )
    throw new Error(`Judge reference spans overlap for ${document.id}`)
}

export function requiresRegeneration(verdict: JudgeVerdict) {
  return (
    !verdict.allProposedSpansCorrect ||
    !verdict.hardNegativesCorrect ||
    verdict.hardNegativeAssertions.some(
      (result) => !result.correctlyUnlabelled,
    ) ||
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

export type ReviewOptions = {
  /** Tournament and benchmark scoring require a two-model adjudicated reference. */
  requireIndependentAdjudication?: boolean
  humanAdjudications?: Map<string, HumanAdjudication>
}

/** Runs independent QA and never silently accepts a disagreement. */
export async function reviewDocuments(
  documents: SyntheticDocument[],
  primaryJudge: JudgeAdapter,
  disputeJudge: JudgeAdapter,
  signal?: AbortSignal,
  options: ReviewOptions = {},
): Promise<Map<string, QaEvidence>> {
  assertIndependentJudges(primaryJudge, disputeJudge)
  const primaryResponses = await primaryJudge.judge(documents, signal)
  const primary = responsesById(primaryResponses, documents, 'Primary QA')
  const escalated = documents.filter(
    (document) =>
      options.requireIndependentAdjudication ||
      escalationReasons(document, primary.get(document.id)!.verdict).length > 0,
  )
  const disputes = escalated.length
    ? await disputeJudge.judge(escalated, signal)
    : []
  const dispute = responsesById(disputes, escalated, 'Second judge')
  return new Map(
    documents.map((document) => {
      const first = primary.get(document.id)!
      const reasons = escalationReasons(document, first.verdict)
      const second = dispute.get(document.id)
      const human = options.humanAdjudications?.get(document.id)
      if (human)
        validateHumanAdjudication(
          document,
          first.verdict,
          second?.verdict,
          human,
        )
      const independentAgreement =
        second && sameReference(first.verdict, second.verdict)
      const disagreement = Boolean(second && !independentAgreement)
      const bothAccepted =
        second !== undefined &&
        !requiresRegeneration(first.verdict) &&
        !requiresRegeneration(second.verdict)
      const primaryAccepted = !requiresRegeneration(first.verdict)
      const canAcceptWithoutSecond =
        primaryAccepted && !options.requireIndependentAdjudication
      const humanApproved = disagreement && human?.decision === 'approved'
      const outcome: QaOutcome = humanApproved
        ? 'accepted'
        : human?.decision === 'rejected'
          ? 'human_rejected'
          : disagreement
            ? 'human_adjudication_required'
            : bothAccepted || canAcceptWithoutSecond
              ? 'accepted'
              : 'repair_required'
      return [
        document.id,
        {
          primary: first.verdict,
          dispute: second?.verdict,
          human,
          primaryTelemetry: first.telemetry,
          primaryRetryTelemetry: first.retryTelemetry,
          disputeTelemetry: second?.telemetry,
          disputeRetryTelemetry: second?.retryTelemetry,
          escalationReasons: reasons,
          outcome,
          accepted: outcome === 'accepted',
          adjudicatedReference:
            independentAgreement && second
              ? {
                  source: 'independent_judge_agreement',
                  spans: first.verdict.referenceSpans,
                }
              : canAcceptWithoutSecond
                ? {
                    source: 'primary_judge',
                    spans: first.verdict.referenceSpans,
                  }
                : humanApproved
                  ? { source: 'human', spans: human.referenceSpans }
                  : undefined,
        },
      ]
    }),
  )
}

export function humanAdjudicationEvidenceHash(
  document: SyntheticDocument,
  primary: JudgeVerdict,
  dispute: JudgeVerdict,
) {
  return canonicalHash({
    documentId: document.id,
    contentHash: document.contentHash,
    primary,
    dispute,
  })
}

export function validateHumanAdjudication(
  document: SyntheticDocument,
  primary: JudgeVerdict,
  dispute: JudgeVerdict | undefined,
  adjudication: HumanAdjudication,
) {
  if (
    !dispute ||
    adjudication.id !== document.id ||
    !adjudication.reviewer.trim() ||
    !Number.isFinite(Date.parse(adjudication.adjudicatedAt)) ||
    !adjudication.rationale.trim() ||
    !/^[a-f0-9]{64}$/.test(adjudication.evidenceHash) ||
    adjudication.evidenceHash !==
      humanAdjudicationEvidenceHash(document, primary, dispute)
  )
    throw new Error(`Human adjudication is stale or invalid for ${document.id}`)
  validateSpans(document.text, adjudication.referenceSpans)
}

/** The released annotation set is always the accepted independent reference. */
export function applyAdjudicatedReference(
  document: SyntheticDocument,
  evidence: QaEvidence,
) {
  if (!evidence.accepted || !evidence.adjudicatedReference)
    throw new Error(
      `Document ${document.id} has no accepted adjudicated reference`,
    )
  validateSpans(document.text, evidence.adjudicatedReference.spans)
  return { ...document, spans: evidence.adjudicatedReference.spans }
}

function responsesById(
  responses: Array<{
    id: string
    verdict: string
    telemetry?: RequestTelemetry
    retryTelemetry?: RequestTelemetry[]
  }>,
  documents: SyntheticDocument[],
  label: string,
) {
  const documentsById = new Map(
    documents.map((document) => [document.id, document]),
  )
  const result = new Map(
    responses.map((response) => {
      const document = documentsById.get(response.id)
      if (!document) throw new Error(`${label} returned an unknown document`)
      let verdict: JudgeVerdict
      try {
        const reference = parseIndependentJudgeReference(
          response.verdict,
          response.id,
          document,
        )
        verdict = evaluateIndependentReference(document, reference)
      } catch {
        // Existing private checkpoints may contain the former full-verdict
        // shape. New provider responses are constrained to quote occurrences.
        verdict = parseJudgeVerdict(response.verdict, response.id, document)
      }
      return [
        response.id,
        {
          verdict,
          telemetry: response.telemetry,
          retryTelemetry: response.retryTelemetry,
        },
      ]
    }),
  )
  if (result.size !== documents.length)
    throw new Error(`${label} omitted one or more documents`)
  return result
}

function sameReference(left: JudgeVerdict, right: JudgeVerdict) {
  return (
    !requiresRegeneration(left) === !requiresRegeneration(right) &&
    left.allProposedSpansCorrect === right.allProposedSpansCorrect &&
    left.hardNegativesCorrect === right.hardNegativesCorrect &&
    JSON.stringify(sortedSpans(left.referenceSpans)) ===
      JSON.stringify(sortedSpans(right.referenceSpans)) &&
    JSON.stringify(sortedHardNegatives(left.hardNegativeAssertions)) ===
      JSON.stringify(sortedHardNegatives(right.hardNegativeAssertions))
  )
}
function sortedSpans(spans: SyntheticSpan[]) {
  return [...spans].sort(
    (left, right) =>
      left.start - right.start ||
      left.end - right.end ||
      left.category.localeCompare(right.category),
  )
}
function sortedHardNegatives(results: HardNegativeJudgeResult[]) {
  return [...results].sort((left, right) =>
    left.assertionId.localeCompare(right.assertionId),
  )
}
function assertIndependentJudges(primary: JudgeAdapter, dispute: JudgeAdapter) {
  if (primary.name === dispute.name || primary.model === dispute.model)
    throw new Error(
      'Primary and adjudicating judges must use independent model identities',
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
