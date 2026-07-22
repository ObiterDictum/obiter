import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertSafeOutputRoot, writeText } from './artifacts'
import { costGbp, type PricingTable } from './budget'
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
import type { DocumentSpec, Usage } from './types'

const defaultSmokeCapGbp = 1
const defaultGbpPerUsd = 0.79
const pricingPath =
  process.env.SYNTHETIC_V2_PRICING_PATH ??
  resolve('scripts/synthetic-v2/pricing-2026-07-21.json')

export function smokeSpecification(): DocumentSpec {
  const source = corpusStageSpecs('tournament').find(
    (spec) => spec.difficulty === 'standard',
  )
  if (!source) throw new Error('Smoke test requires a standard specification')
  return {
    ...source,
    id: 'smoke-00001',
    seed: `smoke:${source.seed}`,
    lengthWords: 300,
    // Provider plumbing does not need the tournament's deliberately nuanced
    // protected/private role distinction; that belongs in paid qualification.
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
  const charge = (
    model: string,
    attempts: number,
    provider?: JudgeProvider,
  ) => {
    const providerKey = provider ? `${provider}:${model}` : undefined
    const rate = (providerKey && pricing[providerKey]) ?? pricing[model]
    if (!rate)
      throw new Error(`No reviewed pricing entry for ${providerKey ?? model}`)
    const usage: Usage = {
      inputTokens: 1500 * attempts,
      outputTokens: 2400 * attempts,
    }
    return costGbp(usage, rate, gbpPerUsd)
  }

  const total = candidates.reduce((sum, candidate) => {
    const writerAttempts = candidate.writer.startsWith('anthropic/') ? 1 : 4
    return (
      sum +
      charge(candidate.writer, writerAttempts) +
      // Initial annotation, mechanical repair, and post-judge repair can each
      // make two locally validated attempts.
      charge(candidate.annotator, 6) +
      // Initial and post-repair QA can each make two validated attempts.
      charge(primaryJudgeModel, 4, primaryJudgeProvider) +
      charge(disputeJudgeModel, 4, disputeJudgeProvider)
    )
  }, 0)
  return Number(total.toFixed(6))
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
  const requestedCandidateId = process.env.SYNTHETIC_V2_SMOKE_CANDIDATE?.trim()
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

  const spec = smokeSpecification()
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
          onProgress: terminalProgress(`smoke:${candidate.id}`),
        },
      )
      const status = result.pendingAdjudications.length
        ? 'human_adjudication_required'
        : result.documentStates.every((state) => state.status === 'accepted')
          ? 'accepted'
          : 'failed'
      if (status === 'failed') failed = true
      console.log(
        `[synthetic-v2] smoke candidate ${candidate.id} complete status=${status}`,
      )
      results.push({
        candidateId: candidate.id,
        writer: candidate.writer,
        annotator: candidate.annotator,
        status,
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
    } catch (error) {
      failed = true
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
      console.error(
        `[synthetic-v2] smoke candidate ${candidate.id} failed: ${error instanceof Error ? error.message : 'unknown error'}${diagnosticSummary ? ` (${diagnosticSummary})` : ''}`,
      )
      results.push({
        candidateId: candidate.id,
        writer: candidate.writer,
        annotator: candidate.annotator,
        status: 'failed',
        error:
          error instanceof Error ? error.message : 'Smoke candidate failed',
        usage:
          error instanceof PipelineExecutionError ? error.usage : undefined,
        spendGbp:
          error instanceof PipelineExecutionError ? error.actualGbp : undefined,
        requestTelemetry: diagnostics,
      })
      // Any failed paid candidate may indicate a shared invariant, accounting,
      // or provider problem. Stop rather than paying for less useful repeats.
      const remaining = candidates.slice(candidateIndex + 1)
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
    specification: spec,
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
