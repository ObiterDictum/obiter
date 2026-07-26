import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalHash, reviewedCandidates } from './governance'
import { corpusStageSpecs } from './program'

export const tournamentCanaryVersion = 'synthetic-v2-tournament-canary:v1'
// Bump whenever prompts, local validation, retries, or provider contracts change
// in a way that can alter real-model tournament qualification.
export const tournamentCanaryContractVersion =
  'synthetic-v2-tournament-provider-contract:2026-07-22.15'
// Comment-only or formatting changes may repin this hash without invalidating
// paid receipts. Qualification changes require a version bump and a repin.
export const tournamentCanaryContractSourceHash =
  '3238a14bc2608db6dab6abfb66885a94a2cbca02db34fdc8ecac2370c432f1ab'

export type CanarySmokeProfile = 'connectivity' | 'tournament-canary'

export function canaryReceiptEligibility(
  results: readonly unknown[],
  profile: CanarySmokeProfile,
  requestedCandidateId: string | undefined,
) {
  const reasons: string[] = []
  if (profile !== 'tournament-canary')
    reasons.push('run: profile is not tournament-canary')
  if (requestedCandidateId !== undefined)
    reasons.push(
      requestedCandidateId
        ? `run: candidate selection was limited to ${requestedCandidateId}`
        : 'run: candidate selection used an empty candidate ID',
    )
  for (
    let index = 0;
    index < Math.max(results.length, reviewedCandidates.length);
    index++
  ) {
    const value = results[index]
    const expected = reviewedCandidates[index]
    if (value === undefined) {
      if (expected) reasons.push(`${expected.id}: result was not recorded`)
      continue
    }
    const result =
      value && typeof value === 'object'
        ? (value as {
            candidateId?: unknown
            writer?: unknown
            annotator?: unknown
            status?: unknown
            firstAttemptValid?: unknown
          })
        : undefined
    const candidateId =
      typeof result?.candidateId === 'string'
        ? result.candidateId
        : (expected?.id ?? `result-${index + 1}`)
    if (!result) {
      reasons.push(`${candidateId}: result is malformed`)
      continue
    }
    if (
      !expected ||
      result.candidateId !== expected.id ||
      result.writer !== expected.writer ||
      result.annotator !== expected.annotator
    )
      reasons.push(
        `${candidateId}: reviewed candidate configuration did not match`,
      )
    if (result.firstAttemptValid !== true)
      reasons.push(
        `${candidateId}: first-attempt provider contract was not valid`,
      )
    if (
      result.status !== 'accepted' &&
      result.status !== 'human_adjudication_required' &&
      result.status !== 'candidate_quality_rejected'
    )
      reasons.push(
        `${candidateId}: status ${String(result.status)} does not qualify`,
      )
  }

  return { eligible: reasons.length === 0, reasons }
}

export type TournamentCanaryConfiguration = {
  primaryJudgeProvider: string
  primaryJudgeModel: string
  disputeJudgeProvider: string
  disputeJudgeModel: string
}

export const reviewedTournamentJudgeConfiguration = {
  primaryJudgeProvider: 'openrouter',
  primaryJudgeModel: 'openai/gpt-4.1',
  disputeJudgeProvider: 'opencode-go',
  disputeJudgeModel: 'grok-4.5',
} as const satisfies TournamentCanaryConfiguration

export function assertReviewedTournamentJudgeConfiguration(
  configuration: TournamentCanaryConfiguration,
) {
  if (
    canonicalHash(configuration) !==
    canonicalHash(reviewedTournamentJudgeConfiguration)
  )
    throw new Error(
      `Tournament judge configuration must be ${reviewedTournamentJudgeConfiguration.primaryJudgeProvider}:${reviewedTournamentJudgeConfiguration.primaryJudgeModel} primary and ${reviewedTournamentJudgeConfiguration.disputeJudgeProvider}:${reviewedTournamentJudgeConfiguration.disputeJudgeModel} dispute`,
    )
}

export function tournamentCanarySpecificationHash() {
  const source = corpusStageSpecs('tournament')[0]
  if (!source) throw new Error('Tournament canary specification is unavailable')
  return canonicalHash(source)
}

export function createTournamentCanaryReceipt(
  configuration: TournamentCanaryConfiguration,
  smokeArtifactHash: string,
) {
  const unsigned = {
    version: tournamentCanaryVersion,
    contractVersion: tournamentCanaryContractVersion,
    tournamentSpecificationHash: tournamentCanarySpecificationHash(),
    candidateConfigurationHash: canonicalHash(reviewedCandidates),
    candidateIds: reviewedCandidates.map((candidate) => candidate.id),
    ...configuration,
    smokeArtifactHash,
  }
  return { ...unsigned, receiptHash: canonicalHash(unsigned) }
}

export async function assertMatchingTournamentCanary(
  privateRoot: string,
  configuration: TournamentCanaryConfiguration,
) {
  const directory = join(privateRoot, 'tournament-canaries')
  let files: string[]
  try {
    files = await readdir(directory)
  } catch {
    throw new Error(
      'Tournament requires a successful full-candidate tournament-canary smoke run',
    )
  }
  for (const file of files.filter((value) => value.endsWith('.json'))) {
    try {
      const receipt = JSON.parse(await readFile(join(directory, file), 'utf8'))
      const { receiptHash, ...unsigned } = receipt
      if (
        receipt.version !== tournamentCanaryVersion ||
        receipt.contractVersion !== tournamentCanaryContractVersion ||
        canonicalHash(unsigned) !== receiptHash ||
        receipt.tournamentSpecificationHash !==
          tournamentCanarySpecificationHash() ||
        receipt.candidateConfigurationHash !==
          canonicalHash(reviewedCandidates) ||
        canonicalHash(receipt.candidateIds) !==
          canonicalHash(reviewedCandidates.map((candidate) => candidate.id)) ||
        receipt.primaryJudgeProvider !== configuration.primaryJudgeProvider ||
        receipt.primaryJudgeModel !== configuration.primaryJudgeModel ||
        receipt.disputeJudgeProvider !== configuration.disputeJudgeProvider ||
        receipt.disputeJudgeModel !== configuration.disputeJudgeModel
      )
        continue
      const artifact = JSON.parse(
        await readFile(
          join(privateRoot, 'smoke', `${receipt.smokeArtifactHash}.json`),
          'utf8',
        ),
      )
      const { artifactHash, ...unsignedArtifact } = artifact
      if (
        artifactHash !== receipt.smokeArtifactHash ||
        canonicalHash(unsignedArtifact) !== artifactHash ||
        artifact.version !== 'synthetic-v2-provider-smoke:v1' ||
        artifact.purpose !== 'diagnostic-only-not-a-corpus-partition' ||
        artifact.profile !== 'tournament-canary' ||
        artifact.tournamentSpecificationHash !==
          tournamentCanarySpecificationHash() ||
        canonicalHash(artifact.specification) !==
          tournamentCanarySpecificationHash() ||
        artifact.primaryJudgeProvider !== configuration.primaryJudgeProvider ||
        artifact.primaryJudgeModel !== configuration.primaryJudgeModel ||
        artifact.disputeJudgeProvider !== configuration.disputeJudgeProvider ||
        artifact.disputeJudgeModel !== configuration.disputeJudgeModel ||
        !Array.isArray(artifact.results)
      )
        continue
      if (
        !canaryReceiptEligibility(
          artifact.results,
          artifact.profile,
          artifact.requestedCandidateId,
        ).eligible ||
        artifact.results.some(
          (result: {
            requestTelemetry?: Array<{
              role?: string
              status?: string
              errorCode?: string
            }>
            documentStates?: Array<{
              generationAttempts?: number
              annotationAttempts?: number
              repairAttempts?: number
              regenerationAttempts?: number
            }>
          }) =>
            !Array.isArray(result.requestTelemetry) ||
            ['writer', 'annotator', 'primary_judge', 'dispute_judge'].some(
              (role) =>
                !result.requestTelemetry!.some(
                  (entry) => entry.role === role && entry.status === 'success',
                ),
            ) ||
            result.requestTelemetry.some(
              (entry) =>
                entry.status === 'error' &&
                (entry.errorCode?.startsWith('annotation_') ||
                  entry.errorCode?.startsWith('judge_')),
            ) ||
            !Array.isArray(result.documentStates) ||
            result.documentStates.some(
              (state) =>
                state.generationAttempts !== 1 ||
                state.annotationAttempts !== 1 ||
                state.repairAttempts !== 0 ||
                state.regenerationAttempts !== 0,
            ),
        )
      )
        continue
      return receiptHash
    } catch {
      // Ignore malformed or stale receipts and continue looking for a match.
    }
  }
  throw new Error(
    'Tournament judge/model configuration has no matching successful tournament-canary smoke receipt',
  )
}
