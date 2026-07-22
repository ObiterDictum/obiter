import { readdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { canonicalHash, reviewedCandidates } from './governance'
import { corpusStageSpecs } from './program'

export const tournamentCanaryVersion = 'synthetic-v2-tournament-canary:v1'
// Bump whenever prompts, local validation, retries, or provider contracts change
// in a way that can alter real-model tournament qualification.
export const tournamentCanaryContractVersion =
  'synthetic-v2-tournament-provider-contract:2026-07-22.4'

export type TournamentCanaryConfiguration = {
  primaryJudgeProvider: string
  primaryJudgeModel: string
  disputeJudgeProvider: string
  disputeJudgeModel: string
}

export const reviewedTournamentJudgeConfiguration = {
  primaryJudgeProvider: 'opencode-go',
  primaryJudgeModel: 'qwen3.7-max',
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
        artifact.requestedCandidateId !== undefined ||
        !Array.isArray(artifact.results) ||
        artifact.results.length !== reviewedCandidates.length ||
        canonicalHash(
          artifact.results.map(
            (result: {
              candidateId?: string
              writer?: string
              annotator?: string
            }) => ({
              id: result.candidateId,
              writer: result.writer,
              annotator: result.annotator,
              reviewed: true,
            }),
          ),
        ) !== canonicalHash(reviewedCandidates) ||
        artifact.results.some(
          (result: {
            status?: string
            firstAttemptValid?: boolean
            documentStates?: Array<{
              generationAttempts?: number
              annotationAttempts?: number
              repairAttempts?: number
              regenerationAttempts?: number
            }>
          }) =>
            result.firstAttemptValid !== true ||
            !Array.isArray(result.documentStates) ||
            result.documentStates.some(
              (state) =>
                state.generationAttempts !== 1 ||
                state.annotationAttempts !== 1 ||
                state.repairAttempts !== 0 ||
                state.regenerationAttempts !== 0,
            ) ||
            (result.status !== 'accepted' &&
              result.status !== 'human_adjudication_required'),
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
