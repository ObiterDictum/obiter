import { reviewedCandidates } from './governance'
import { validateSpans } from './markers'
import {
  spanCategories,
  type RequestTelemetry,
  type SyntheticDocument,
  type SyntheticSpan,
  type Usage,
} from './types'
import { contentHash } from './validation'
import type { HumanAdjudication, QaEvidence } from './qa'
import type {
  DocumentProcessingState,
  PendingAdjudication,
  RunStage,
  TournamentCandidateCheckpointMetadata,
} from './checkpoints'

export function isPendingAdjudication(
  value: unknown,
): value is PendingAdjudication {
  return (
    isRecord(value) &&
    isSyntheticDocument(value.document) &&
    isQaEvidence(value.evidence) &&
    isDocumentProcessingState(value.state) &&
    value.state.id === value.document.id
  )
}

export function isSyntheticDocument(
  value: unknown,
): value is SyntheticDocument {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    !value.id ||
    typeof value.text !== 'string' ||
    typeof value.generator !== 'string' ||
    typeof value.specCell !== 'string' ||
    !Array.isArray(value.matrixCells) ||
    !value.matrixCells.every((cell) => typeof cell === 'string') ||
    !isHash(value.contentHash) ||
    !Array.isArray(value.spans) ||
    !value.spans.every(isSyntheticSpan)
  )
    return false
  if (value.contentHash !== contentHash(value.text)) return false
  try {
    validateSpans(value.text, value.spans)
    return true
  } catch {
    return false
  }
}

export function isQaEvidence(value: unknown): value is QaEvidence {
  return (
    isRecord(value) &&
    isJudgeVerdict(value.primary) &&
    (value.dispute === undefined || isJudgeVerdict(value.dispute)) &&
    (value.human === undefined || isHumanAdjudication(value.human)) &&
    (value.primaryTelemetry === undefined ||
      isRequestTelemetry(value.primaryTelemetry)) &&
    (value.primaryRetryTelemetry === undefined ||
      isRequestTelemetryArray(value.primaryRetryTelemetry)) &&
    (value.disputeTelemetry === undefined ||
      isRequestTelemetry(value.disputeTelemetry)) &&
    (value.disputeRetryTelemetry === undefined ||
      isRequestTelemetryArray(value.disputeRetryTelemetry)) &&
    Array.isArray(value.escalationReasons) &&
    value.escalationReasons.every((reason) => typeof reason === 'string') &&
    isStringIn(value.outcome, [
      'accepted',
      'repair_required',
      'human_adjudication_required',
      'human_rejected',
    ]) &&
    typeof value.accepted === 'boolean' &&
    (value.adjudicatedReference === undefined ||
      (isRecord(value.adjudicatedReference) &&
        isStringIn(value.adjudicatedReference.source, [
          'primary_judge',
          'independent_judge_agreement',
          'human',
        ]) &&
        Array.isArray(value.adjudicatedReference.spans) &&
        value.adjudicatedReference.spans.every(isSyntheticSpan)))
  )
}

export function isDocumentProcessingState(
  value: unknown,
): value is DocumentProcessingState {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    isStringIn(value.status, [
      'accepted',
      'repair_required',
      'human_adjudication_required',
      'failed',
    ]) &&
    [
      value.generationAttempts,
      value.annotationAttempts,
      value.repairAttempts,
      value.regenerationAttempts,
      value.qaAttempts,
    ].every(isNonNegativeInteger) &&
    Array.isArray(value.transitions) &&
    value.transitions.every(
      (transition) =>
        isRecord(transition) &&
        typeof transition.phase === 'string' &&
        (transition.reason === undefined ||
          typeof transition.reason === 'string'),
    ) &&
    Array.isArray(value.telemetryRequestIds) &&
    value.telemetryRequestIds.every((id) => typeof id === 'string')
  )
}

export function isTournamentCandidateIdentity(
  value: unknown,
): value is TournamentCandidateCheckpointMetadata['candidate'] {
  if (
    !isRecord(value) ||
    typeof value.candidateId !== 'string' ||
    typeof value.writer !== 'string' ||
    typeof value.annotator !== 'string' ||
    !isBlindId(value.blindId) ||
    !isStringArray(value.specificationIds) ||
    !isStringArray(value.seeds)
  )
    return false
  const candidate = reviewedCandidates.find(
    (entry) => entry.id === value.candidateId,
  )
  return Boolean(
    candidate &&
    candidate.writer === value.writer &&
    candidate.annotator === value.annotator,
  )
}

function isRequestTelemetryArray(value: unknown): value is RequestTelemetry[] {
  return Array.isArray(value) && value.every(isRequestTelemetry)
}

export function isRequestTelemetry(value: unknown): value is RequestTelemetry {
  return (
    isRecord(value) &&
    typeof value.requestId === 'string' &&
    typeof value.specId === 'string' &&
    isStringIn(value.role, [
      'writer',
      'annotator',
      'primary_judge',
      'dispute_judge',
    ]) &&
    (value.provider === undefined || typeof value.provider === 'string') &&
    typeof value.requestedModel === 'string' &&
    (value.returnedModel === undefined ||
      typeof value.returnedModel === 'string') &&
    (value.usage === undefined || isUsage(value.usage)) &&
    isNonNegativeNumber(value.latencyMs) &&
    isStringIn(value.status, ['success', 'error', 'aborted']) &&
    (value.errorCode === undefined || typeof value.errorCode === 'string') &&
    isPositiveInteger(value.attempt) &&
    (value.retryOfRequestId === undefined ||
      typeof value.retryOfRequestId === 'string')
  )
}

export function isUsage(value: unknown): value is Usage {
  return (
    isRecord(value) &&
    isNonNegativeNumber(value.inputTokens) &&
    isNonNegativeNumber(value.outputTokens) &&
    (value.cacheCreationInputTokens === undefined ||
      isNonNegativeNumber(value.cacheCreationInputTokens)) &&
    (value.cacheReadInputTokens === undefined ||
      isNonNegativeNumber(value.cacheReadInputTokens))
  )
}

export function isSyntheticSpan(value: unknown): value is SyntheticSpan {
  return (
    isRecord(value) &&
    typeof value.category === 'string' &&
    spanCategories.some((category) => category === value.category) &&
    isNonNegativeInteger(value.start) &&
    isNonNegativeInteger(value.end) &&
    value.end >= value.start &&
    typeof value.text === 'string'
  )
}

export function sameIdentifiers(actual: string[], expected: string[]) {
  return (
    actual.length === expected.length &&
    new Set(actual).size === actual.length &&
    actual.every((id) => expected.includes(id))
  )
}

export function isRunStage(value: unknown): value is RunStage {
  return (
    value === 'training_seed' ||
    value === 'development_challenge' ||
    value === 'benchmark'
  )
}

export function isBlindId(value: unknown): value is string {
  return typeof value === 'string' && /^review-[1-9][0-9]*$/.test(value)
}

export function isHashArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isHash)
}

export function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function isJudgeVerdict(value: unknown): value is QaEvidence['primary'] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.allProposedSpansCorrect === 'boolean' &&
    typeof value.hardNegativesCorrect === 'boolean' &&
    Array.isArray(value.hardNegativeAssertions) &&
    value.hardNegativeAssertions.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.assertionId === 'string' &&
        typeof entry.correctlyUnlabelled === 'boolean',
    ) &&
    Array.isArray(value.referenceSpans) &&
    value.referenceSpans.every(isSyntheticSpan) &&
    Array.isArray(value.obviousUnmarkedSpans) &&
    value.obviousUnmarkedSpans.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.category === 'string' &&
        typeof entry.text === 'string',
    ) &&
    isNonNegativeNumber(value.realismScore) &&
    isNonNegativeNumber(value.confidence) &&
    typeof value.rationale === 'string'
  )
}

function isHumanAdjudication(value: unknown): value is HumanAdjudication {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    (value.decision === 'approved' || value.decision === 'rejected') &&
    typeof value.reviewer === 'string' &&
    Number.isFinite(Date.parse(String(value.adjudicatedAt))) &&
    typeof value.rationale === 'string' &&
    Array.isArray(value.referenceSpans) &&
    value.referenceSpans.every(isSyntheticSpan) &&
    isHash(value.evidenceHash)
  )
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string')
  )
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isPositiveInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 1
}

function isStringIn(
  value: unknown,
  values: readonly string[],
): value is string {
  return typeof value === 'string' && values.includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}
