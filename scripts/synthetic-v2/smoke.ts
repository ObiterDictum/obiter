import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertSafeOutputRoot, writeText } from './artifacts'
import { pipelineWorstCaseGbp, type PricingTable } from './budget'
import { canonicalHash, reviewedCandidates, type Candidate } from './governance'
import { corpusStageSpecs } from './program'
import {
  createJudgeAdapter,
  DeepSeekGenerator,
  type JudgeProvider,
  OpenRouterGenerator,
  OpenRouterLabeler,
  parseJudgeProvider,
  ProviderBatchError,
} from './providers'
import { PipelineExecutionError, runPipeline, terminalProgress } from './run'
import {
  assertReviewedTournamentJudgeConfiguration,
  canaryReceiptEligibility,
  createTournamentCanaryReceipt,
  tournamentCanarySpecificationHash,
  type CanarySmokeProfile,
} from './canary'
import type { DocumentSpec, RequestTelemetry } from './types'

const defaultSmokeCapGbp = 1
const defaultGbpPerUsd = 0.79
export type SmokeProfile = CanarySmokeProfile

export function firstAttemptContractValid(
  telemetry: RequestTelemetry[],
  documentStates: Array<{
    generationAttempts: number
    annotationAttempts: number
    repairAttempts: number
    regenerationAttempts: number
  }>,
) {
  const structuralRetry = telemetry.some(
    (entry) =>
      entry.status === 'error' &&
      (entry.errorCode?.startsWith('annotation_') ||
        entry.errorCode?.startsWith('judge_')),
  )
  const successfulRoles = new Set(
    telemetry
      .filter((entry) => entry.status === 'success')
      .map((entry) => entry.role),
  )
  return (
    !structuralRetry &&
    ['writer', 'annotator', 'primary_judge', 'dispute_judge'].every((role) =>
      successfulRoles.has(role as RequestTelemetry['role']),
    ) &&
    documentStates.every(
      (state) =>
        state.generationAttempts === 1 &&
        state.annotationAttempts === 1 &&
        state.repairAttempts === 0 &&
        state.regenerationAttempts === 0,
    )
  )
}
const pricingPath =
  process.env.SYNTHETIC_V2_PRICING_PATH ??
  resolve('scripts/synthetic-v2/pricing-2026-07-21.json')

export function parseSmokeProfile(value: string | undefined): SmokeProfile {
  const profile = value?.trim() || 'connectivity'
  if (profile !== 'connectivity' && profile !== 'tournament-canary')
    throw new Error(`Unsupported SYNTHETIC_V2_SMOKE_PROFILE: ${profile}`)
  return profile
}

export function smokeSpecification(
  profile: SmokeProfile = 'connectivity',
): DocumentSpec {
  const source = corpusStageSpecs('tournament')[0]
  if (!source) throw new Error('Smoke test requires a tournament specification')
  if (profile === 'tournament-canary') return { ...source }
  return {
    ...source,
    id: 'smoke-00001',
    seed: `smoke:${source.seed}`,
    lengthWords: 300,
    // This profile proves connectivity only. Tournament qualification must use
    // the unabridged tournament-canary profile above.
    requiredCategories: source.requiredCategories.filter(
      (category) => category !== 'person_protected',
    ),
    matrixCells: source.matrixCells.filter(
      (cell) => !cell.includes('|person_protected|'),
    ),
    hardNegatives: [],
  }
}

export function smokeWorstCaseGbp(
  pricing: PricingTable,
  primaryJudgeModel: string,
  disputeJudgeModel: string,
  gbpPerUsd = defaultGbpPerUsd,
  primaryJudgeProvider?: JudgeProvider,
  disputeJudgeProvider?: JudgeProvider,
  candidates: Candidate[] = reviewedCandidates,
) {
  const primaryProviderKey = primaryJudgeProvider
    ? `${primaryJudgeProvider}:${primaryJudgeModel}`
    : undefined
  const disputeProviderKey = disputeJudgeProvider
    ? `${disputeJudgeProvider}:${disputeJudgeModel}`
    : undefined
  const primaryJudgePricingKey =
    (primaryProviderKey && pricing[primaryProviderKey]
      ? primaryProviderKey
      : undefined) ?? primaryJudgeModel
  const disputeJudgePricingKey =
    (disputeProviderKey && pricing[disputeProviderKey]
      ? disputeProviderKey
      : undefined) ?? disputeJudgeModel
  return pipelineWorstCaseGbp(
    pricing,
    candidates,
    primaryJudgePricingKey,
    disputeJudgePricingKey,
    1,
    gbpPerUsd,
  )
}

export function assertSmokeBudget(estimatedGbp: number, capGbp: number) {
  if (!Number.isFinite(capGbp) || capGbp <= 0)
    throw new Error('SYNTHETIC_V2_SMOKE_MAX_GBP must be a positive number')
  if (estimatedGbp > capGbp)
    throw new Error(
      `Smoke worst-case reservation GBP ${estimatedGbp.toFixed(6)} exceeds cap ${capGbp.toFixed(6)}`,
    )
}

export function assertSmokeOptIn() {
  if (process.env.OBITER_RUN_SYNTHETIC_V2 !== '1')
    throw new Error(
      'Refusing smoke provider calls. Set OBITER_RUN_SYNTHETIC_V2=1 explicitly.',
    )
  if (process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED !== '1')
    throw new Error('DeepSeek terms gate is not confirmed')
}

export async function main() {
  assertSmokeOptIn()
  const profile = parseSmokeProfile(
    process.argv
      .find((value) => value.startsWith('--profile='))
      ?.slice('--profile='.length) ?? process.env.SYNTHETIC_V2_SMOKE_PROFILE,
  )
  const primaryJudgeModel = requiredModel('SYNTHETIC_V2_PRIMARY_JUDGE_MODEL')
  const disputeJudgeModel = requiredModel('SYNTHETIC_V2_ADJUDICATOR_MODEL')
  const primaryJudgeProvider = parseJudgeProvider(
    process.env.SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER,
    'SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER',
  )
  const disputeJudgeProvider = parseJudgeProvider(
    process.env.SYNTHETIC_V2_ADJUDICATOR_PROVIDER,
    'SYNTHETIC_V2_ADJUDICATOR_PROVIDER',
  )
  if (profile === 'tournament-canary')
    assertReviewedTournamentJudgeConfiguration({
      primaryJudgeProvider,
      primaryJudgeModel,
      disputeJudgeProvider,
      disputeJudgeModel,
    })
  const requestedCandidateId =
    process.env.SYNTHETIC_V2_SMOKE_CANDIDATE?.trim() || undefined
  const candidates = requestedCandidateId
    ? reviewedCandidates.filter(
        (candidate) => candidate.id === requestedCandidateId,
      )
    : reviewedCandidates
  if (requestedCandidateId && candidates.length === 0)
    throw new Error(
      `SYNTHETIC_V2_SMOKE_CANDIDATE is not reviewed: ${requestedCandidateId}`,
    )
  const pricing = await loadPricing(pricingPath)
  const gbpPerUsd = positiveNumber(
    process.env.SYNTHETIC_V2_GBP_PER_USD ?? String(defaultGbpPerUsd),
    'SYNTHETIC_V2_GBP_PER_USD',
  )
  const capGbp = positiveNumber(
    process.env.SYNTHETIC_V2_SMOKE_MAX_GBP ?? String(defaultSmokeCapGbp),
    'SYNTHETIC_V2_SMOKE_MAX_GBP',
  )
  const estimatedMaxGbp = smokeWorstCaseGbp(
    pricing,
    primaryJudgeModel,
    disputeJudgeModel,
    gbpPerUsd,
    primaryJudgeProvider,
    disputeJudgeProvider,
    candidates,
  )
  assertSmokeBudget(estimatedMaxGbp, capGbp)
  // Validate the private destination before constructing adapters or making
  // any billable request.
  const privateRoot =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  const approvedRoot = await assertSafeOutputRoot(
    privateRoot,
    process.cwd(),
    'private-corpus',
    'tournament',
  )

  const spec = smokeSpecification(profile)
  const results: unknown[] = []
  let failed = false
  for (const [candidateIndex, candidate] of candidates.entries()) {
    console.log(
      `[synthetic-v2] smoke candidate ${candidateIndex + 1}/${candidates.length} ${candidate.id} starting`,
    )
    try {
      assertDistinctRoleModels(
        candidate.writer,
        candidate.annotator,
        primaryJudgeModel,
        disputeJudgeModel,
      )
      const writer = candidate.writer.startsWith('anthropic/')
        ? new OpenRouterGenerator(candidate.writer)
        : new DeepSeekGenerator(candidate.writer)
      const result = await runPipeline(
        [spec],
        writer,
        new OpenRouterLabeler(candidate.annotator),
        createJudgeAdapter(primaryJudgeProvider, primaryJudgeModel),
        createJudgeAdapter(
          disputeJudgeProvider,
          disputeJudgeModel,
          'dispute_judge',
        ),
        pricing,
        [],
        {
          requireIndependentAdjudication: true,
          maxRegenerations: 0,
          failFastOnTerminalState: true,
          onProgress: terminalProgress(`smoke:${candidate.id}`),
        },
      )
      const firstAttemptValid = firstAttemptContractValid(
        result.requestTelemetry,
        result.documentStates,
      )
      const status = !firstAttemptValid
        ? 'failed_contract_retry'
        : result.pendingAdjudications.length
          ? 'human_adjudication_required'
          : result.documentStates.every((state) => state.status === 'accepted')
            ? 'accepted'
            : 'failed'
      if (status === 'failed' || status === 'failed_contract_retry')
        failed = true
      console.log(
        `[synthetic-v2] smoke candidate ${candidate.id} complete status=${status}`,
      )
      results.push({
        candidateId: candidate.id,
        writer: candidate.writer,
        annotator: candidate.annotator,
        status,
        firstAttemptValid,
        documents: result.documents,
        pendingAdjudications: result.pendingAdjudications,
        qa: [...result.qa],
        firstPassAnnotations: [...result.firstPassAnnotations],
        finalPassAnnotations: [...result.finalPassAnnotations],
        documentStates: result.documentStates,
        usage: result.usage,
        spendGbp: result.actualGbp,
        requestTelemetry: result.requestTelemetry,
      })
      if (status === 'failed' || status === 'failed_contract_retry') {
        const remaining = candidates.slice(candidateIndex + 1)
        for (const skipped of remaining)
          results.push({
            candidateId: skipped.id,
            writer: skipped.writer,
            annotator: skipped.annotator,
            status: 'skipped_after_failure',
          })
        console.error(
          `[synthetic-v2] smoke stopped early; skipped ${remaining.length} paid candidate(s) after returned terminal state`,
        )
        break
      }
    } catch (error) {
      const candidateQualityRejection =
        error instanceof PipelineExecutionError
          ? error.candidateQualityRejection
          : undefined
      if (!candidateQualityRejection) failed = true
      const diagnostics =
        error instanceof PipelineExecutionError
          ? error.requestTelemetry
          : error instanceof ProviderBatchError
            ? error.telemetry
            : undefined
      const diagnosticSummary = diagnostics
        ?.map(
          (entry) =>
            `${entry.provider ?? 'unknown'}:${entry.requestedModel}:${entry.errorCode ?? entry.status}`,
        )
        .join(', ')
      const documentStates =
        error instanceof PipelineExecutionError ? error.documentStates : []
      const firstAttemptValid = candidateQualityRejection
        ? firstAttemptContractValid(diagnostics ?? [], documentStates)
        : false
      console.error(
        `[synthetic-v2] smoke candidate ${candidate.id} ${candidateQualityRejection ? 'quality-rejected' : 'failed'}: ${error instanceof Error ? error.message : 'unknown error'}${diagnosticSummary ? ` (${diagnosticSummary})` : ''}`,
      )
      results.push({
        candidateId: candidate.id,
        writer: candidate.writer,
        annotator: candidate.annotator,
        status: candidateQualityRejection
          ? 'candidate_quality_rejected'
          : 'failed',
        firstAttemptValid,
        rejection: candidateQualityRejection,
        error:
          error instanceof Error ? error.message : 'Smoke candidate failed',
        usage:
          error instanceof PipelineExecutionError ? error.usage : undefined,
        spendGbp:
          error instanceof PipelineExecutionError ? error.actualGbp : undefined,
        requestTelemetry: diagnostics,
        documentStates,
      })
      // Any terminal candidate result stops a selected diagnostic. Full
      // qualification continues after quality rejection so all reviewed role
      // routes are exercised, but operational failure always stops.
      const remaining = candidates.slice(candidateIndex + 1)
      if (candidateQualityRejection && !requestedCandidateId) continue
      for (const skipped of remaining)
        results.push({
          candidateId: skipped.id,
          writer: skipped.writer,
          annotator: skipped.annotator,
          status: 'skipped_after_failure',
        })
      if (remaining.length)
        console.error(
          `[synthetic-v2] smoke stopped early; skipped ${remaining.length} paid candidate(s) after failure`,
        )
      break
    }
  }

  const unsigned = {
    version: 'synthetic-v2-provider-smoke:v1' as const,
    purpose: 'diagnostic-only-not-a-corpus-partition' as const,
    generatedAt: new Date().toISOString(),
    profile,
    specification: spec,
    tournamentSpecificationHash:
      profile === 'tournament-canary'
        ? tournamentCanarySpecificationHash()
        : undefined,
    primaryJudgeProvider,
    primaryJudgeModel,
    disputeJudgeProvider,
    disputeJudgeModel,
    requestedCandidateId,
    estimatedMaxGbp,
    capGbp,
    results,
  }
  const artifact = { ...unsigned, artifactHash: canonicalHash(unsigned) }
  const outputPath = resolve(
    approvedRoot,
    'smoke',
    `${artifact.artifactHash}.json`,
  )
  await writeText(outputPath, `${JSON.stringify(artifact)}\n`)
  console.log(`Synthetic v2 smoke artifact: ${outputPath}`)
  console.log(`Worst-case reserved spend: GBP ${estimatedMaxGbp.toFixed(6)}`)
  if (profile === 'tournament-canary' && !requestedCandidateId) {
    const receiptEligibility = canaryReceiptEligibility(
      results,
      profile,
      requestedCandidateId,
    )
    if (!receiptEligibility.eligible) {
      for (const reason of receiptEligibility.reasons)
        console.error(`[synthetic-v2] tournament canary ineligible ${reason}`)
      throw new Error(
        'Synthetic v2 tournament canary did not qualify for a receipt',
      )
    }
    const receipt = createTournamentCanaryReceipt(
      {
        primaryJudgeProvider,
        primaryJudgeModel,
        disputeJudgeProvider,
        disputeJudgeModel,
      },
      artifact.artifactHash,
    )
    const receiptPath = resolve(
      approvedRoot,
      'tournament-canaries',
      `${receipt.receiptHash}.json`,
    )
    await writeText(receiptPath, `${JSON.stringify(receipt)}\n`)
    console.log(`Synthetic v2 tournament canary receipt: ${receiptPath}`)
  }
  if (failed)
    throw new Error(
      'Synthetic v2 smoke test recorded one or more failed candidates',
    )
}

async function loadPricing(path: string): Promise<PricingTable> {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8')) as PricingTable
  } catch {
    throw new Error('Could not read smoke pricing configuration')
  }
}

function positiveNumber(value: string, name: string) {
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0)
    throw new Error(`${name} must be a positive number`)
  return parsed
}

function requiredModel(name: string) {
  const model = process.env[name]?.trim()
  if (!model)
    throw new Error(`${name} must name an independently configured judge model`)
  return model
}

function assertDistinctRoleModels(
  writer: string,
  annotator: string,
  primary: string,
  dispute: string,
) {
  if (new Set([writer, annotator, primary, dispute]).size !== 4)
    throw new Error(
      'Writer, annotator, primary judge, and dispute judge must use distinct model identities',
    )
}

if (process.argv[1] && resolve(process.argv[1]).endsWith('smoke.ts'))
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Synthetic v2 smoke test failed',
    )
    process.exitCode = 1
  })
