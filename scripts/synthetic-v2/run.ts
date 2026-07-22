import { readFile, realpath } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { isAbsolute, join, relative, resolve } from 'node:path'
import {
  costGbp,
  maximumBillableRequestUsage,
  pipelineWorstCaseGbp,
  readLedger,
  reconcileSpend,
  reserveSpend,
  type PricingTable,
} from './budget'
import {
  assertSafeOutputRoot,
  writeDatasetAtomically,
  writeText,
} from './artifacts'
import {
  assertMatchingTournamentCanary,
  assertReviewedTournamentJudgeConfiguration,
  tournamentCanaryContractVersion,
} from './canary'
import {
  assertApprovedModel,
  assertExternalPartitionRegistry,
  blindReviewPackage,
  assertBlindReviewPackage,
  assertPartitionManifest,
  assertSelectionManifest,
  assertTournamentManifest,
  canonicalHash,
  requireSelection,
  reviewedCandidates,
  selectedCandidate,
  type PartitionManifest,
} from './governance'
import { assertTournamentStratification } from './matrix'
import { scoreAdjudicatedDocuments } from './scoring'
import { corpusStageSpecs, isCorpusStage, type CorpusStage } from './program'
import {
  createJudgeAdapter,
  DeepSeekGenerator,
  OpenRouterGenerator,
  OpenRouterLabeler,
  parseJudgeProvider,
  ProviderBatchError,
} from './providers'
import {
  applyAdjudicatedReference,
  reviewDocuments,
  supplementMisses,
  type HumanAdjudication,
  type QaEvidence,
} from './qa'
import type {
  DocumentSpec,
  GeneratedDocument,
  GeneratorAdapter,
  JudgeAdapter,
  LabelingAdapter,
  ProviderRole,
  RequestTelemetry,
  SyntheticDocument,
  Usage,
} from './types'
import { NearDuplicateIndex, normalizeAnnotated } from './validation'
import {
  assertPendingAdjudicationArtifact,
  assertRunCheckpointMetadata,
  assertTournamentCandidateCheckpointMetadata,
  pendingAdjudicationArtifact,
  persistPendingAdjudications,
  resumePendingAdjudications,
  type DocumentProcessingState,
  type PendingAdjudication,
  type PendingAdjudicationArtifact,
  type RunCheckpointMetadata,
  type TournamentCandidateCheckpointMetadata,
} from './checkpoints'
import {
  persistTournamentCandidateContinuation,
  resumeTournamentCandidate,
} from './tournament-resume'

export {
  assertPendingAdjudicationArtifact,
  assertRunCheckpointMetadata,
  assertTournamentCandidateCheckpointMetadata,
  pendingAdjudicationArtifact,
  persistPendingAdjudications,
  resumePendingAdjudications,
} from './checkpoints'
export type {
  DocumentProcessingState,
  PendingAdjudication,
  PendingAdjudicationArtifact,
  RunCheckpointMetadata,
  TournamentCandidateCheckpointMetadata,
} from './checkpoints'
export { assertTournamentCandidateContinuation } from './tournament-resume'

const gbpPerUsd = Number(process.env.SYNTHETIC_V2_GBP_PER_USD ?? '0.79')
export const defaultMaxRegenerations = 2
function configuredLedgerPath() {
  return resolve(
    process.env.SYNTHETIC_V2_LEDGER ?? '.synthetic-v2/spend-ledger.json',
  )
}
const pricingPath =
  process.env.SYNTHETIC_V2_PRICING_PATH ??
  resolve('scripts/synthetic-v2/pricing-2026-07-21.json')

export class PipelineExecutionError extends Error {
  readonly name = 'PipelineExecutionError'

  constructor(
    message: string,
    readonly usage: Usage,
    readonly actualGbp: number,
    readonly requestTelemetry: RequestTelemetry[],
  ) {
    super(message)
  }
}

export class ChargedAccountingError extends Error {
  readonly name = 'ChargedAccountingError'

  constructor(
    message: string,
    readonly usage: Usage,
    readonly actualGbp: number,
    readonly requestTelemetry: RequestTelemetry[],
    options?: ErrorOptions,
  ) {
    super(message, options)
  }
}

export type PipelineResult = {
  documents: SyntheticDocument[]
  /** Initial annotation predictions, retained even when later repaired. */
  firstPassAnnotations: Map<string, SyntheticDocument['spans']>
  /** Final model predictions before adjudicated references replace export spans. */
  finalPassAnnotations: Map<string, SyntheticDocument['spans']>
  pendingAdjudications: PendingAdjudication[]
  qa: Map<string, QaEvidence>
  documentStates: DocumentProcessingState[]
  usage: Usage
  actualGbp: number
  requestTelemetry: RequestTelemetry[]
}

export type PipelineProgress = {
  specId: string
  completed: number
  total: number
  phase: 'generate' | 'label' | 'repair_label' | 'judge' | 'complete'
  attempt?: number
  status?: DocumentProcessingState['status']
}

export type PipelineOptions = {
  requireIndependentAdjudication?: boolean
  maxRegenerations?: number
  failFastOnTerminalState?: boolean
  humanAdjudications?: Map<string, HumanAdjudication>
  onProgress?: (progress: PipelineProgress) => void
}

export async function main() {
  if (process.argv.includes('--assemble-tournament'))
    return assembleTournamentCandidateRuns()
  const stage = flag('--stage')
  if (!isCorpusStage(stage))
    throw new Error(
      'Select an explicit stage: --stage=tournament, training_seed, development_challenge, or benchmark.',
    )
  const tournamentResumePath = flag('--resume-tournament-candidate')
  if (tournamentResumePath) {
    if (stage !== 'tournament')
      throw new Error('Tournament candidate resume requires --stage=tournament')
    const [artifact, dispositions, tournament] = await Promise.all([
      loadJson<PendingAdjudicationArtifact>(
        tournamentResumePath,
        'tournament candidate checkpoint',
      ),
      loadJson<HumanAdjudication[]>(
        requiredFlag('--human-dispositions'),
        'human dispositions',
      ),
      loadJson<unknown>(
        requiredFlag('--tournament-manifest'),
        'tournament manifest',
      ),
    ])
    const continuation = resumeTournamentCandidate(
      artifact,
      dispositions,
      tournament,
    )
    const privateRoot =
      process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
      '../obiter-redaction-data-private'
    await persistTournamentCandidateContinuation(
      privateRoot,
      process.cwd(),
      continuation,
    )
    return
  }
  const resumePath = flag('--resume-pending')
  if (resumePath) {
    const artifact = await loadJson<PendingAdjudicationArtifact>(
      resumePath,
      'pending adjudication artifact',
    )
    const dispositions = await loadJson<HumanAdjudication[]>(
      requiredFlag('--human-dispositions'),
      'human dispositions',
    )
    if (stage === 'tournament' || artifact.stage === 'tournament')
      throw new Error(
        'Tournament adjudications require --resume-tournament-candidate',
      )
    if (artifact.stage !== stage)
      throw new Error(
        'Pending adjudication artifact stage does not match --stage',
      )
    const resumed = resumePendingAdjudications(artifact, dispositions)
    if (resumed.rejected.length)
      throw new Error(
        'Human adjudication rejected one or more pending documents',
      )
    assertRunCheckpointMetadata(resumed.metadata, stage)
    const privateRoot =
      process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
      '../obiter-redaction-data-private'
    await writeDatasetAtomically(resumed.accepted, {
      root: privateRoot,
      productRoot: process.cwd(),
      rootKind: 'private-corpus',
      stage: stage === 'benchmark' ? 'benchmark_candidate' : stage,
      metadata: {
        ...resumed.metadata,
        stage,
        version: 'synthetic-v2-resumed-adjudication:v3',
        pendingArtifactHash: artifact.artifactHash,
        acceptedCount: resumed.accepted.length,
      },
    })
    return
  }
  assertNetworkOptIn()
  assertDeepSeekTermsConfirmation()
  const pricing = await loadJson<PricingTable>(
    pricingPath,
    'pricing configuration',
  )
  if (stage === 'tournament') return runTournament(pricing)
  const selection = await loadSelection()
  const tournament = await loadTournament()
  requireSelection(stage, selection, tournament)
  const candidate = selectedCandidate(selection)
  const writer = writerAdapter(candidate.writer)
  const labeler = new OpenRouterLabeler(candidate.annotator)
  const primary = configuredJudge('primary')
  const dispute = configuredJudge('adjudicator')
  assertDistinctRoleModels(
    candidate.writer,
    candidate.annotator,
    primary.model,
    dispute.model,
  )
  const external = await loadExternalPartitions(stage)
  const result = await runPipeline(
    corpusStageSpecs(stage),
    writer,
    labeler,
    primary,
    dispute,
    pricing,
    external.manifests,
    {
      requireIndependentAdjudication: stage === 'benchmark',
      onProgress: terminalProgress(stage),
    },
  )
  assertApprovedModel(selection, 'writer', candidate.writer, writer.model)
  assertApprovedModel(
    selection,
    'annotator',
    candidate.annotator,
    labeler.model,
  )
  const privateRoot =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  const metadata: RunCheckpointMetadata = {
    stage,
    version: 'synthetic-v2-run:v2',
    selection,
    tournamentManifestHash: tournament.manifestHash,
    qa: [...result.qa],
    firstPassAnnotations: [...result.firstPassAnnotations],
    finalPassAnnotations: [...result.finalPassAnnotations],
    documentStates: result.documentStates,
    usage: result.usage,
    spendGbp: result.actualGbp,
    requestTelemetry: result.requestTelemetry,
    partitionRegistryHash: external.registryHash,
    externalPartitionHashes: external.manifests.map((manifest) =>
      canonicalHash(manifest),
    ),
  }
  if (result.pendingAdjudications.length) {
    const artifact = pendingAdjudicationArtifact(
      stage,
      corpusStageSpecs(stage).map((spec) => spec.id),
      metadata,
      result.documents,
      result.pendingAdjudications,
    )
    await persistPendingAdjudications(privateRoot, process.cwd(), artifact)
    throw new Error('Pipeline has documents pending human adjudication')
  }
  if (result.documentStates.some((state) => state.status !== 'accepted'))
    throw new Error('Pipeline has documents pending repair')
  const outputPrivateRoot =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  const outputStage = stage === 'benchmark' ? 'benchmark_candidate' : stage
  await writeDatasetAtomically(result.documents, {
    root: outputPrivateRoot,
    productRoot: process.cwd(),
    rootKind: 'private-corpus',
    stage: outputStage,
    metadata,
  })
}

/**
 * Processes each immutable document as an explicit state machine. A failed
 * label pass is repaired once; failed QA then regenerates source and labels.
 * Unresolved judge disagreement is retained as human-adjudication state.
 */
export async function runPipeline(
  specs: DocumentSpec[],
  writer: GeneratorAdapter,
  labeler: LabelingAdapter,
  primaryJudge: JudgeAdapter,
  disputeJudge: JudgeAdapter,
  pricing: PricingTable,
  externalPartitions: PartitionManifest[] = [],
  options: PipelineOptions = {},
): Promise<PipelineResult> {
  const abort = new AbortController()
  for (const manifest of externalPartitions) assertPartitionManifest(manifest)
  const index = new NearDuplicateIndex(
    0.82,
    externalPartitions.flatMap((manifest) => manifest.nearDuplicateSignatures),
  )
  const externalHashes = new Set(
    externalPartitions.flatMap((manifest) =>
      manifest.documents.map((document) => document.textHash),
    ),
  )
  const telemetry: RequestTelemetry[] = []
  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  let actualGbp = 0
  const documents: SyntheticDocument[] = []
  const firstPassAnnotations = new Map<string, SyntheticDocument['spans']>()
  const finalPassAnnotations = new Map<string, SyntheticDocument['spans']>()
  const pendingAdjudications: PendingAdjudication[] = []
  const qa = new Map<string, QaEvidence>()
  const documentStates: DocumentProcessingState[] = []
  const maxRegenerations = options.maxRegenerations ?? defaultMaxRegenerations
  assertConfiguredPricing(pricing, [
    writer,
    labeler,
    primaryJudge,
    disputeJudge,
  ])
  if (!Number.isInteger(maxRegenerations) || maxRegenerations < 0)
    throw new Error('maxRegenerations must be a non-negative integer')

  const recordedRequestIds = new Set<string>()
  const recordTelemetry = (entry: RequestTelemetry) => {
    if (recordedRequestIds.has(entry.requestId)) return false
    recordedRequestIds.add(entry.requestId)
    telemetry.push(entry)
    return true
  }
  const consumeCharged = (value: ChargedResult) => {
    addUsage(usage, value.usage)
    actualGbp += value.cost
    for (const item of value.items) {
      for (const entry of [...(item.retryTelemetry ?? []), item.telemetry])
        if (entry) recordTelemetry(entry)
    }
  }
  const consumeQa = (evidence: QaEvidence, state: DocumentProcessingState) => {
    for (const entry of [
      ...(evidence.primaryRetryTelemetry ?? []),
      evidence.primaryTelemetry,
      ...(evidence.disputeRetryTelemetry ?? []),
      evidence.disputeTelemetry,
    ]) {
      if (!entry) continue
      if (!state.telemetryRequestIds.includes(entry.requestId))
        state.telemetryRequestIds.push(entry.requestId)
      if (!recordTelemetry(entry)) continue
      if (entry.usage) {
        addUsage(usage, entry.usage)
        actualGbp += telemetryCost(entry, pricing)
      }
    }
  }
  const meteredPrimaryJudge = meteredJudge(
    primaryJudge,
    pricing,
    consumeCharged,
  )
  const meteredDisputeJudge = meteredJudge(
    disputeJudge,
    pricing,
    consumeCharged,
  )

  try {
    for (const [specIndex, spec] of specs.entries()) {
      const state: DocumentProcessingState = {
        id: spec.id,
        status: 'failed',
        generationAttempts: 0,
        annotationAttempts: 0,
        repairAttempts: 0,
        regenerationAttempts: 0,
        qaAttempts: 0,
        transitions: [],
        telemetryRequestIds: [],
      }
      documentStates.push(state)
      for (
        let regeneration = 0;
        regeneration <= maxRegenerations;
        regeneration++
      ) {
        state.generationAttempts++
        if (regeneration > 0) state.regenerationAttempts++
        state.transitions.push({
          phase: 'generate',
          reason: regeneration ? 'qa_or_validation_rejection' : undefined,
        })
        options.onProgress?.({
          specId: spec.id,
          completed: specIndex,
          total: specs.length,
          phase: 'generate',
          attempt: regeneration + 1,
        })
        const drafts = await submitDocuments(
          [spec],
          writer,
          pricing,
          abort.signal,
        )
        consumeCharged(drafts)
        appendStateTelemetry(state, drafts.items)
        const draft = drafts.items[0]
        if (!draft) throw new Error(`Provider omitted ${spec.id}`)

        state.annotationAttempts++
        state.transitions.push({ phase: 'label' })
        options.onProgress?.({
          specId: spec.id,
          completed: specIndex,
          total: specs.length,
          phase: 'label',
        })
        const labels = await submitLabels(
          [spec],
          new Map([[spec.id, draft]]),
          labeler,
          pricing,
          abort.signal,
        )
        consumeCharged(labels)
        appendStateTelemetry(state, labels.items)
        const label = labels.items[0]
        if (!label)
          throw new Error(`Provider omitted annotations for ${spec.id}`)
        // Replace this only when the source is regenerated; repairs must not
        // erase the original prediction used for hard-negative FPR.
        firstPassAnnotations.set(spec.id, label.spans)
        let candidate = normaliseCandidate(spec, draft, label.spans)

        if (
          typeof candidate === 'string' ||
          supplementMisses([candidate]).length
        ) {
          state.repairAttempts++
          state.annotationAttempts++
          state.transitions.push({
            phase: 'repair_label',
            reason:
              typeof candidate === 'string'
                ? candidate
                : 'mechanical_supplement_miss',
          })
          options.onProgress?.({
            specId: spec.id,
            completed: specIndex,
            total: specs.length,
            phase: 'repair_label',
          })
          const feedback = new Map([
            [
              spec.id,
              typeof candidate === 'string'
                ? candidate
                : 'Mechanical supplement found unlabelled PII; return exhaustive corrected spans.',
            ],
          ])
          const repaired = await submitRepair(
            spec,
            draft,
            labeler,
            feedback,
            pricing,
            abort.signal,
          )
          consumeCharged(repaired)
          appendStateTelemetry(state, repaired.items)
          const repairedLabel = repaired.items[0]
          if (!repairedLabel)
            throw new Error(
              `Provider omitted repaired annotations for ${spec.id}`,
            )
          candidate = normaliseCandidate(spec, draft, repairedLabel.spans)
        }
        if (
          typeof candidate === 'string' ||
          supplementMisses([candidate]).length
        ) {
          state.transitions.push({
            phase: 'regenerate',
            reason:
              typeof candidate === 'string'
                ? candidate
                : 'mechanical_supplement_miss',
          })
          continue
        }
        if (externalHashes.has(candidate.contentHash)) {
          state.transitions.push({
            phase: 'regenerate',
            reason: 'cross_partition_exact_duplicate',
          })
          continue
        }
        const duplicate = index.check(candidate)
        if (duplicate) {
          state.transitions.push({
            phase: 'regenerate',
            reason: `near_duplicate:${duplicate.right}:${duplicate.similarity}`,
          })
          continue
        }

        finalPassAnnotations.set(candidate.id, candidate.spans)
        state.qaAttempts++
        state.transitions.push({ phase: 'judge' })
        options.onProgress?.({
          specId: spec.id,
          completed: specIndex,
          total: specs.length,
          phase: 'judge',
        })
        const evidence = (
          await reviewDocuments(
            [candidate],
            meteredPrimaryJudge,
            meteredDisputeJudge,
            abort.signal,
            {
              requireIndependentAdjudication:
                options.requireIndependentAdjudication,
              humanAdjudications: options.humanAdjudications,
            },
          )
        ).get(spec.id)
        if (!evidence) throw new Error(`QA omitted ${spec.id}`)
        qa.set(spec.id, evidence)
        consumeQa(evidence, state)
        if (evidence.accepted) {
          const finalized = applyAdjudicatedReference(candidate, evidence)
          index.add(finalized)
          documents.push(finalized)
          state.status = 'accepted'
          state.transitions.push({ phase: 'accepted' })
          break
        }
        if (evidence.outcome === 'human_adjudication_required') {
          pendingAdjudications.push({ document: candidate, evidence, state })
          state.status = 'human_adjudication_required'
          state.transitions.push({ phase: 'human_adjudication_required' })
          break
        }
        state.repairAttempts++
        state.annotationAttempts++
        state.transitions.push({
          phase: 'repair_label',
          reason: 'judge_rejection',
        })
        const qaRepair = await submitRepair(
          spec,
          draft,
          labeler,
          new Map([[spec.id, evidence.primary.rationale]]),
          pricing,
          abort.signal,
        )
        consumeCharged(qaRepair)
        appendStateTelemetry(state, qaRepair.items)
        const repairedLabel = qaRepair.items[0]
        const repairedCandidate = repairedLabel
          ? normaliseCandidate(spec, draft, repairedLabel.spans)
          : 'Provider omitted repaired annotations'
        if (
          typeof repairedCandidate !== 'string' &&
          !supplementMisses([repairedCandidate]).length
        ) {
          finalPassAnnotations.set(
            repairedCandidate.id,
            repairedCandidate.spans,
          )
          state.qaAttempts++
          state.transitions.push({ phase: 'judge_repaired_annotation' })
          const repairedEvidence = (
            await reviewDocuments(
              [repairedCandidate],
              meteredPrimaryJudge,
              meteredDisputeJudge,
              abort.signal,
              {
                requireIndependentAdjudication:
                  options.requireIndependentAdjudication,
                humanAdjudications: options.humanAdjudications,
              },
            )
          ).get(spec.id)
          if (!repairedEvidence)
            throw new Error(`QA omitted repaired ${spec.id}`)
          qa.set(spec.id, repairedEvidence)
          consumeQa(repairedEvidence, state)
          if (repairedEvidence.accepted) {
            const finalized = applyAdjudicatedReference(
              repairedCandidate,
              repairedEvidence,
            )
            index.add(finalized)
            documents.push(finalized)
            state.status = 'accepted'
            state.transitions.push({ phase: 'accepted_after_repair' })
            break
          }
          if (repairedEvidence.outcome === 'human_adjudication_required') {
            pendingAdjudications.push({
              document: repairedCandidate,
              evidence: repairedEvidence,
              state,
            })
            state.status = 'human_adjudication_required'
            state.transitions.push({ phase: 'human_adjudication_required' })
            break
          }
        }
        state.status = 'repair_required'
        state.transitions.push({
          phase: 'regenerate',
          reason: evidence.outcome,
        })
      }
      if (state.status === 'repair_required') state.status = 'failed'
      options.onProgress?.({
        specId: spec.id,
        completed: specIndex + 1,
        total: specs.length,
        phase: 'complete',
        status: state.status,
      })
      if (options.failFastOnTerminalState && state.status === 'failed')
        throw new Error(
          `Document ${spec.id} exhausted validation and regeneration attempts`,
        )
    }
    assertTelemetryModelIdentity(
      telemetry,
      {
        writer: writer.model,
        annotator: labeler.model,
        primary_judge: primaryJudge.model,
        dispute_judge: disputeJudge.model,
      },
      {
        writer: providerFromAdapter(writer),
        annotator: providerFromAdapter(labeler),
        primary_judge: providerFromAdapter(primaryJudge),
        dispute_judge: providerFromAdapter(disputeJudge),
      },
    )
    return {
      documents,
      firstPassAnnotations,
      finalPassAnnotations,
      pendingAdjudications,
      qa,
      documentStates,
      usage,
      actualGbp: Number(actualGbp.toFixed(6)),
      requestTelemetry: telemetry,
    }
  } catch (error) {
    abort.abort(error)
    if (error instanceof ChargedAccountingError) {
      addUsage(usage, error.usage)
      actualGbp += error.actualGbp
      telemetry.push(...error.requestTelemetry)
    }
    if (error instanceof ProviderBatchError)
      for (const entry of error.telemetry) {
        telemetry.push(entry)
        if (entry.usage) {
          addUsage(usage, entry.usage)
          actualGbp += telemetryCost(entry, pricing)
        }
      }
    throw new PipelineExecutionError(
      error instanceof Error ? error.message : 'Pipeline execution failed',
      { ...usage },
      Number(actualGbp.toFixed(6)),
      [...telemetry],
    )
  }
}

function normaliseCandidate(
  spec: DocumentSpec,
  draft: GeneratedDocument,
  spans: SyntheticDocument['spans'],
) {
  try {
    return normalizeAnnotated(spec, draft, spans)
  } catch (error) {
    return error instanceof Error
      ? error.message
      : 'annotation validation failed'
  }
}

async function runTournament(pricing: PricingTable) {
  const specs = corpusStageSpecs('tournament')
  assertTournamentStratification(specs)
  const selectedTournamentCandidate = selectTournamentCandidate(
    process.env.SYNTHETIC_V2_TOURNAMENT_CANDIDATE,
  )
  const requestedCandidateId = selectedTournamentCandidate.id
  const candidates = [selectedTournamentCandidate]
  const outputs: Array<{
    candidateId: string
    blindId: string
    specificationIds: string[]
    seeds: string[]
    canonicalArtifactHash: string
    blindReviewPackageHash: string
    finalStatus: 'pending_review' | 'human_adjudication_required' | 'rejected'
  }> = []
  const candidateArtifacts: unknown[] = []
  const blindReviewPackages: unknown[] = []
  const primaryProvider = parseJudgeProvider(
    process.env.SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER,
    'SYNTHETIC_V2_PRIMARY_JUDGE_PROVIDER',
  )
  const disputeProvider = parseJudgeProvider(
    process.env.SYNTHETIC_V2_ADJUDICATOR_PROVIDER,
    'SYNTHETIC_V2_ADJUDICATOR_PROVIDER',
  )
  const primaryModel = requiredModel('SYNTHETIC_V2_PRIMARY_JUDGE_MODEL')
  const disputeModel = requiredModel('SYNTHETIC_V2_ADJUDICATOR_MODEL')
  assertReviewedTournamentJudgeConfiguration({
    primaryJudgeProvider: primaryProvider,
    primaryJudgeModel: primaryModel,
    disputeJudgeProvider: disputeProvider,
    disputeJudgeModel: disputeModel,
  })
  const primaryProviderPricingKey = `${primaryProvider}:${primaryModel}`
  const disputeProviderPricingKey = `${disputeProvider}:${disputeModel}`
  const estimatedMaxGbp = pipelineWorstCaseGbp(
    pricing,
    candidates,
    pricing[primaryProviderPricingKey]
      ? primaryProviderPricingKey
      : primaryModel,
    pricing[disputeProviderPricingKey]
      ? disputeProviderPricingKey
      : disputeModel,
    specs.length,
    gbpPerUsd,
    1,
  )
  const tournamentCapGbp = assertTournamentBudget(
    estimatedMaxGbp,
    process.env.SYNTHETIC_V2_TOURNAMENT_CANDIDATE_MAX_GBP,
  )
  const root =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  const approvedRoot = await assertSafeOutputRoot(
    root,
    process.cwd(),
    'private-corpus',
    'tournament',
  )
  const canaryReceiptHash = await assertMatchingTournamentCanary(approvedRoot, {
    primaryJudgeProvider: primaryProvider,
    primaryJudgeModel: primaryModel,
    disputeJudgeProvider: disputeProvider,
    disputeJudgeModel: disputeModel,
  })
  console.log(
    `[synthetic-v2] tournament preflight worst-case=GBP ${estimatedMaxGbp.toFixed(6)} cap=GBP ${tournamentCapGbp.toFixed(6)}`,
  )
  const primary = createJudgeAdapter(
    primaryProvider,
    primaryModel,
    'primary_judge',
  )
  const dispute = createJudgeAdapter(
    disputeProvider,
    disputeModel,
    'dispute_judge',
  )
  for (const candidate of candidates) {
    const blindId = `review-${reviewedCandidates.findIndex((reviewed) => reviewed.id === candidate.id) + 1}`
    let artifact: unknown
    let blindPackage: ReturnType<typeof blindReviewPackage> | undefined
    let pipelineResult: PipelineResult | undefined
    let finalStatus:
      'pending_review' | 'human_adjudication_required' | 'rejected' = 'rejected'
    let checkpointHash: string | undefined
    try {
      assertDistinctRoleModels(
        candidate.writer,
        candidate.annotator,
        primaryModel,
        disputeModel,
      )
      pipelineResult = await runPipeline(
        specs,
        writerAdapter(candidate.writer),
        new OpenRouterLabeler(candidate.annotator),
        primary,
        dispute,
        pricing,
        [],
        {
          requireIndependentAdjudication: true,
          maxRegenerations: 0,
          failFastOnTerminalState: true,
          onProgress: terminalProgress(`tournament:${candidate.id}`),
        },
      )
      const result = pipelineResult
      if (result.pendingAdjudications.length) {
        const metadata: TournamentCandidateCheckpointMetadata = {
          version: 'synthetic-v2-tournament-candidate:v1',
          stage: 'tournament',
          candidate: {
            candidateId: candidate.id,
            writer: candidate.writer,
            annotator: candidate.annotator,
            blindId,
            specificationIds: specs.map((spec) => spec.id),
            seeds: specs.map((spec) => spec.seed),
          },
          qa: [...result.qa],
          firstPassAnnotations: [...result.firstPassAnnotations],
          finalPassAnnotations: [...result.finalPassAnnotations],
          documentStates: result.documentStates,
          usage: result.usage,
          spendGbp: result.actualGbp,
          requestTelemetry: result.requestTelemetry,
        }
        const checkpoint = pendingAdjudicationArtifact(
          'tournament',
          specs.map((spec) => spec.id),
          metadata,
          result.documents,
          result.pendingAdjudications,
        )
        await persistPendingAdjudications(root, process.cwd(), checkpoint)
        artifact = checkpoint
        checkpointHash = checkpoint.artifactHash
        finalStatus = 'human_adjudication_required'
      } else {
        if (result.documentStates.some((state) => state.status !== 'accepted'))
          throw new Error('Candidate has unresolved documents')
        artifact = {
          version: 'synthetic-v2-tournament-candidate:v2',
          candidateId: candidate.id,
          blindId,
          specs: specs.map(({ id, seed }) => ({ id, seed })),
          documents: result.documents,
          qa: [...result.qa],
          metrics: scoreAdjudicatedDocuments(
            result.documents,
            result.qa,
            result.finalPassAnnotations,
            result.firstPassAnnotations,
          ),
          usage: result.usage,
          spendGbp: result.actualGbp,
          requestTelemetry: result.requestTelemetry,
          documentStates: result.documentStates,
          firstPassAnnotations: [...result.firstPassAnnotations],
          finalPassAnnotations: [...result.finalPassAnnotations],
        }
        blindPackage = blindReviewPackage(blindId, result.documents)
        finalStatus = 'pending_review'
      }
    } catch (error) {
      const accountedError = accountTournamentError(error, pipelineResult)
      const diagnostics =
        accountedError instanceof PipelineExecutionError
          ? accountedError.requestTelemetry
          : accountedError instanceof ProviderBatchError
            ? accountedError.telemetry
            : undefined
      const diagnosticSummary = diagnostics
        ?.map(
          (entry) =>
            `${entry.provider ?? 'unknown'}:${entry.requestedModel}:${entry.errorCode ?? entry.status}`,
        )
        .join(', ')
      const failedArtifact = {
        version: 'synthetic-v2-tournament-failure:v1',
        candidateId: candidate.id,
        specs: specs.map(({ id, seed }) => ({ id, seed })),
        status: 'failed',
        error:
          accountedError instanceof Error
            ? accountedError.message
            : 'Unknown candidate failure',
        usage:
          accountedError instanceof PipelineExecutionError
            ? accountedError.usage
            : undefined,
        spendGbp:
          accountedError instanceof PipelineExecutionError
            ? accountedError.actualGbp
            : undefined,
        requestTelemetry: diagnostics,
      }
      const candidateQualityRejection =
        isCandidateQualityRejection(accountedError)
      if (candidateQualityRejection) {
        artifact = {
          ...failedArtifact,
          status: 'rejected',
          rejectionKind: 'candidate_quality',
        }
        console.error(
          `[synthetic-v2] tournament candidate ${candidate.id} rejected after terminal document validation`,
        )
      } else {
        artifact = failedArtifact
        candidateArtifacts.push(artifact)
        await stopFailedTournament({
          approvedRoot,
          candidateId: candidate.id,
          primaryJudgeProvider: primaryProvider,
          primaryJudgeModel: primaryModel,
          disputeJudgeProvider: disputeProvider,
          disputeJudgeModel: disputeModel,
          candidateArtifacts,
          completedCandidates: outputs,
          error: accountedError,
          diagnosticSummary,
        })
      }
    }
    candidateArtifacts.push(artifact)
    if (blindPackage) blindReviewPackages.push(blindPackage)
    outputs.push({
      candidateId: candidate.id,
      blindId,
      specificationIds: specs.map((spec) => spec.id),
      seeds: specs.map((spec) => spec.seed),
      canonicalArtifactHash: checkpointHash ?? canonicalHash(artifact),
      blindReviewPackageHash: canonicalHash(
        blindPackage ?? { status: 'ineligible' },
      ),
      finalStatus,
    })
  }
  const unsignedRun = {
    version: 'synthetic-v2-tournament-candidate-run:v1' as const,
    providerContractVersion: tournamentCanaryContractVersion,
    canaryReceiptHash,
    tournamentSpecificationHash: canonicalHash(specs),
    candidateConfigurationHash: canonicalHash(reviewedCandidates),
    pricingConfigurationHash: canonicalHash(pricing),
    gbpPerUsd,
    maxRegenerations: 0,
    estimatedMaxGbp,
    capGbp: tournamentCapGbp,
    primaryJudgeProvider: primaryProvider,
    primaryJudgeModel: primaryModel,
    disputeJudgeProvider: disputeProvider,
    disputeJudgeModel: disputeModel,
    candidate: outputs[0],
    candidateArtifact: candidateArtifacts[0],
    blindReviewPackage: blindReviewPackages[0],
  }
  const candidateRun = {
    ...unsignedRun,
    artifactHash: canonicalHash(unsignedRun),
  }
  const candidateRunPath = join(
    approvedRoot,
    'tournament-candidate-runs',
    requestedCandidateId,
    `${candidateRun.artifactHash}.json`,
  )
  await writeText(candidateRunPath, `${JSON.stringify(candidateRun)}\n`)
  console.log(
    `[synthetic-v2] tournament candidate complete candidate=${requestedCandidateId} status=${outputs[0]?.finalStatus} artifact=${candidateRunPath}`,
  )
}

export function selectTournamentCandidate(value: string | undefined) {
  const candidateId = value?.trim()
  if (!candidateId)
    throw new Error(
      'SYNTHETIC_V2_TOURNAMENT_CANDIDATE must select one reviewed candidate',
    )
  const candidate = reviewedCandidates.find((entry) => entry.id === candidateId)
  if (!candidate)
    throw new Error(
      `SYNTHETIC_V2_TOURNAMENT_CANDIDATE is not reviewed: ${candidateId}`,
    )
  return candidate
}

export async function assembleTournamentCandidateRuns() {
  const root =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  const approvedRoot = await assertSafeOutputRoot(
    root,
    process.cwd(),
    'private-corpus',
    'tournament',
  )
  const approvedRealRoot = await realpath(approvedRoot)
  const configuredRegistryPath = requiredFlag('--candidate-run-registry')
  const registryPath = await realpath(
    isAbsolute(configuredRegistryPath)
      ? configuredRegistryPath
      : resolve(approvedRealRoot, configuredRegistryPath),
  )
  const registryRelativePath = relative(approvedRealRoot, registryPath)
  if (
    !registryRelativePath ||
    registryRelativePath.startsWith('..') ||
    isAbsolute(registryRelativePath)
  )
    throw new Error(
      'Tournament candidate-run registry must be inside the private root',
    )
  const registry = await loadJson<{
    version: string
    candidateRuns: Array<{
      candidateId: string
      path: string
      artifactHash: string
    }>
    registryHash: string
  }>(registryPath, 'tournament candidate-run registry')
  const { registryHash, ...unsignedRegistry } = registry
  if (
    canonicalHash(unsignedRegistry) !== registryHash ||
    registry.version !== 'synthetic-v2-tournament-candidate-run-registry:v1' ||
    !Array.isArray(registry.candidateRuns) ||
    registry.candidateRuns.length !== reviewedCandidates.length
  )
    throw new Error('Tournament candidate-run registry is invalid')
  const runs: Array<Record<string, unknown>> = []
  const seen = new Set<string>()
  for (const entry of registry.candidateRuns) {
    if (
      !reviewedCandidates.some(
        (candidate) => candidate.id === entry.candidateId,
      ) ||
      seen.has(entry.candidateId)
    )
      throw new Error(
        'Tournament candidate-run registry has invalid candidates',
      )
    const path = await realpath(resolve(approvedRealRoot, entry.path))
    const pathFromRoot = relative(approvedRealRoot, path)
    if (pathFromRoot.startsWith('..') || isAbsolute(pathFromRoot))
      throw new Error(
        'Tournament candidate-run artifact must be inside the private root',
      )
    const expectedPath = await realpath(
      join(
        approvedRealRoot,
        'tournament-candidate-runs',
        entry.candidateId,
        `${entry.artifactHash}.json`,
      ),
    )
    if (path !== expectedPath)
      throw new Error('Tournament candidate-run path does not match its hash')
    const run = await loadJson<Record<string, unknown>>(
      path,
      `tournament candidate run ${entry.candidateId}`,
    )
    const { artifactHash, ...unsigned } = run
    if (
      run.version !== 'synthetic-v2-tournament-candidate-run:v1' ||
      artifactHash !== entry.artifactHash ||
      canonicalHash(unsigned) !== artifactHash ||
      run.providerContractVersion !== tournamentCanaryContractVersion ||
      typeof run.canaryReceiptHash !== 'string' ||
      !/^[a-f0-9]{64}$/.test(run.canaryReceiptHash) ||
      typeof run.primaryJudgeProvider !== 'string' ||
      typeof run.primaryJudgeModel !== 'string' ||
      typeof run.disputeJudgeProvider !== 'string' ||
      typeof run.disputeJudgeModel !== 'string' ||
      run.tournamentSpecificationHash !==
        canonicalHash(corpusStageSpecs('tournament')) ||
      run.candidateConfigurationHash !== canonicalHash(reviewedCandidates) ||
      typeof run.pricingConfigurationHash !== 'string' ||
      typeof run.gbpPerUsd !== 'number' ||
      run.maxRegenerations !== 0 ||
      typeof run.estimatedMaxGbp !== 'number' ||
      typeof run.capGbp !== 'number' ||
      run.estimatedMaxGbp > run.capGbp ||
      !run.candidate ||
      typeof run.candidate !== 'object' ||
      (run.candidate as { candidateId?: string }).candidateId !==
        entry.candidateId ||
      (run.candidate as { canonicalArtifactHash?: string })
        .canonicalArtifactHash !==
        embeddedArtifactHash(run.candidateArtifact) ||
      (run.candidate as { blindReviewPackageHash?: string })
        .blindReviewPackageHash !==
        canonicalHash(run.blindReviewPackage ?? { status: 'ineligible' })
    )
      throw new Error(
        `Tournament candidate run is invalid: ${entry.candidateId}`,
      )
    assertTournamentCandidateRunEvidence(
      run,
      entry.candidateId,
      corpusStageSpecs('tournament'),
    )
    seen.add(entry.candidateId)
    runs.push(run)
  }
  const first = runs[0]!
  for (const run of runs.slice(1))
    for (const field of [
      'providerContractVersion',
      'canaryReceiptHash',
      'pricingConfigurationHash',
      'gbpPerUsd',
      'maxRegenerations',
      'primaryJudgeProvider',
      'primaryJudgeModel',
      'disputeJudgeProvider',
      'disputeJudgeModel',
    ])
      if (run[field] !== first[field])
        throw new Error(
          'Tournament candidate runs use different judge configurations',
        )
  const assembledJudgeConfiguration = {
    primaryJudgeProvider: requiredStringField(first, 'primaryJudgeProvider'),
    primaryJudgeModel: requiredStringField(first, 'primaryJudgeModel'),
    disputeJudgeProvider: requiredStringField(first, 'disputeJudgeProvider'),
    disputeJudgeModel: requiredStringField(first, 'disputeJudgeModel'),
  }
  assertReviewedTournamentJudgeConfiguration(assembledJudgeConfiguration)
  const matchingCanaryReceiptHash = await assertMatchingTournamentCanary(
    approvedRealRoot,
    assembledJudgeConfiguration,
  )
  if (matchingCanaryReceiptHash !== first.canaryReceiptHash)
    throw new Error('Tournament candidate runs do not match the active canary')
  const ordered = reviewedCandidates.map((reviewed) => {
    const run = runs.find(
      (candidate) =>
        (candidate.candidate as { candidateId?: string }).candidateId ===
        reviewed.id,
    )
    if (!run)
      throw new Error(`Missing tournament candidate run: ${reviewed.id}`)
    return run
  })
  const outputs = ordered.map((run) => run.candidate)
  const candidateArtifacts = ordered.map((run) => run.candidateArtifact)
  const blindReviewPackages = ordered
    .map((run) => run.blindReviewPackage)
    .filter((value) => value !== undefined)
  const unsignedManifest = {
    version: 'synthetic-v2-tournament:v1' as const,
    candidates: outputs,
  }
  const manifest = {
    ...unsignedManifest,
    manifestHash: canonicalHash(unsignedManifest),
  }
  assertTournamentManifest(manifest)
  await writeDatasetAtomically([], {
    root: approvedRoot,
    productRoot: process.cwd(),
    rootKind: 'private-corpus',
    stage: 'tournament',
    metadata: {
      stage: 'tournament',
      tournament: manifest,
      candidateArtifacts,
      blindReviewPackages,
      candidateRunRegistryHash: registryHash,
      candidateRunHashes: ordered.map((run) => run.artifactHash),
    },
    beforeCommit: async (staging) => {
      await writeText(
        join(staging, 'TOURNAMENT.json'),
        `${JSON.stringify(manifest)}\n`,
      )
    },
  })
  console.log(
    `[synthetic-v2] tournament assembled candidates=${outputs.length}/${reviewedCandidates.length}`,
  )
}

function requiredStringField(value: Record<string, unknown>, field: string) {
  const selected = value[field]
  if (typeof selected !== 'string')
    throw new Error(`Tournament candidate run requires ${field}`)
  return selected
}

function assertTournamentCandidateRunEvidence(
  run: Record<string, unknown>,
  candidateId: string,
  specs: DocumentSpec[],
) {
  const output = run.candidate as {
    candidateId?: string
    blindId?: string
    specificationIds?: unknown
    seeds?: unknown
    finalStatus?: string
  }
  const reviewedIndex = reviewedCandidates.findIndex(
    (candidate) => candidate.id === candidateId,
  )
  if (
    output.candidateId !== candidateId ||
    output.blindId !== `review-${reviewedIndex + 1}` ||
    canonicalHash(output.specificationIds) !==
      canonicalHash(specs.map((spec) => spec.id)) ||
    canonicalHash(output.seeds) !==
      canonicalHash(specs.map((spec) => spec.seed))
  )
    throw new Error(`Tournament candidate evidence is misbound: ${candidateId}`)
  if (output.finalStatus === 'human_adjudication_required') {
    const pendingArtifact = run.candidateArtifact
    assertPendingAdjudicationArtifact(pendingArtifact)
    assertTournamentCandidateCheckpointMetadata(pendingArtifact.metadata)
    if (
      pendingArtifact.stage !== 'tournament' ||
      pendingArtifact.metadata.candidate.candidateId !== candidateId ||
      pendingArtifact.metadata.candidate.blindId !== output.blindId ||
      canonicalHash(pendingArtifact.expectedSpecificationIds) !==
        canonicalHash(specs.map((spec) => spec.id))
    )
      throw new Error('Pending tournament candidate evidence is misbound')
    if (run.blindReviewPackage !== undefined)
      throw new Error('Pending candidate cannot have a blind review package')
    return
  }
  if (output.finalStatus === 'pending_review') {
    const artifact = run.candidateArtifact
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      !('version' in artifact) ||
      artifact.version !== 'synthetic-v2-tournament-candidate:v2' ||
      !('candidateId' in artifact) ||
      artifact.candidateId !== candidateId ||
      !('blindId' in artifact) ||
      artifact.blindId !== output.blindId ||
      !('specs' in artifact) ||
      canonicalHash(artifact.specs) !==
        canonicalHash(specs.map(({ id, seed }) => ({ id, seed }))) ||
      !('documents' in artifact) ||
      !Array.isArray(artifact.documents) ||
      artifact.documents.length !== specs.length
    )
      throw new Error('Pending-review candidate artifact is invalid')
    assertBlindReviewPackage(run.blindReviewPackage)
    return
  }
  if (output.finalStatus === 'rejected') {
    const artifact = run.candidateArtifact
    if (
      !artifact ||
      typeof artifact !== 'object' ||
      !('status' in artifact) ||
      artifact.status !== 'rejected' ||
      run.blindReviewPackage !== undefined
    )
      throw new Error('Rejected candidate evidence is invalid')
    return
  }
  throw new Error(`Tournament candidate run has invalid status: ${candidateId}`)
}

export function isCandidateQualityRejection(error: unknown) {
  return (
    error instanceof PipelineExecutionError &&
    error.message.startsWith('Document ') &&
    error.message.endsWith(' exhausted validation and regeneration attempts')
  )
}

function embeddedArtifactHash(value: unknown) {
  if (
    value &&
    typeof value === 'object' &&
    'artifactHash' in value &&
    typeof value.artifactHash === 'string'
  )
    return value.artifactHash
  return canonicalHash(value)
}

export function accountTournamentError(
  error: unknown,
  pipelineResult: PipelineResult | undefined,
) {
  if (error instanceof PipelineExecutionError || !pipelineResult) return error
  return new PipelineExecutionError(
    error instanceof Error
      ? error.message
      : 'Tournament post-processing failed',
    pipelineResult.usage,
    pipelineResult.actualGbp,
    pipelineResult.requestTelemetry,
  )
}

export function assertTournamentBudget(
  estimatedGbp: number,
  configuredCap: string | undefined,
) {
  if (!Number.isFinite(estimatedGbp) || estimatedGbp <= 0)
    throw new Error('Tournament worst-case spend estimate must be positive')
  if (!configuredCap)
    throw new Error(
      'SYNTHETIC_V2_TOURNAMENT_CANDIDATE_MAX_GBP must explicitly cap one candidate run',
    )
  const capGbp = Number(configuredCap)
  if (!Number.isFinite(capGbp) || capGbp <= 0)
    throw new Error(
      'SYNTHETIC_V2_TOURNAMENT_CANDIDATE_MAX_GBP must be positive',
    )
  if (estimatedGbp > capGbp)
    throw new Error(
      `Tournament worst-case reservation GBP ${estimatedGbp.toFixed(6)} exceeds cap ${capGbp.toFixed(6)}`,
    )
  return capGbp
}

export async function stopFailedTournament(context: {
  approvedRoot: string
  candidateId: string
  primaryJudgeProvider: string
  primaryJudgeModel: string
  disputeJudgeProvider: string
  disputeJudgeModel: string
  candidateArtifacts: unknown[]
  completedCandidates: unknown[]
  error: unknown
  diagnosticSummary?: string
}) {
  const unsignedFailure = {
    version: 'synthetic-v2-failed-tournament-run:v1',
    failedCandidateId: context.candidateId,
    primaryJudgeProvider: context.primaryJudgeProvider,
    primaryJudgeModel: context.primaryJudgeModel,
    disputeJudgeProvider: context.disputeJudgeProvider,
    disputeJudgeModel: context.disputeJudgeModel,
    candidateArtifacts: context.candidateArtifacts,
    completedCandidates: context.completedCandidates,
  }
  const failureArtifact = {
    ...unsignedFailure,
    artifactHash: canonicalHash(unsignedFailure),
  }
  const failurePath = join(
    context.approvedRoot,
    'failed-tournaments',
    `${failureArtifact.artifactHash}.json`,
  )
  await writeText(failurePath, `${JSON.stringify(failureArtifact)}\n`)
  console.error(
    `[synthetic-v2] tournament candidate ${context.candidateId} failed: ${context.error instanceof Error ? context.error.message : 'unknown error'}${context.diagnosticSummary ? ` (${context.diagnosticSummary})` : ''}`,
  )
  console.error(
    `[synthetic-v2] tournament stopped after terminal failure; evidence=${failurePath}`,
  )
  throw new Error(
    `Synthetic v2 tournament stopped after ${context.candidateId} failed`,
  )
}

type ChargedItem = {
  usage: Usage
  telemetry?: RequestTelemetry
  retryTelemetry?: RequestTelemetry[]
}
type ChargedResult<T extends ChargedItem = ChargedItem> = {
  items: T[]
  usage: Usage
  cost: number
}

export function assertConfiguredPricing(
  pricing: PricingTable,
  adapters: Array<{ model: string; name?: string }>,
) {
  for (const adapter of adapters) {
    const pricingKey =
      adapter.name && pricing[adapter.name] ? adapter.name : adapter.model
    if (!pricing[pricingKey])
      throw new Error(
        `No reviewed pricing entry for ${adapter.name ?? adapter.model}`,
      )
  }
}

function meteredJudge(
  adapter: JudgeAdapter,
  pricing: PricingTable,
  onCharged: (result: ChargedResult) => void,
): JudgeAdapter {
  return {
    ...adapter,
    judge: async (documents, signal) => {
      const result = await charged(
        adapter.name,
        adapter.maxChargeAttempts,
        documents,
        pricing,
        async () =>
          (await adapter.judge(documents, signal)).map((response) => ({
            ...response,
            usage: response.telemetry?.usage ?? {
              inputTokens: 0,
              outputTokens: 0,
            },
          })),
      )
      onCharged(result)
      return result.items
    },
  }
}

async function submitDocuments(
  specs: DocumentSpec[],
  adapter: GeneratorAdapter,
  pricing: PricingTable,
  signal: AbortSignal,
) {
  return charged(adapter.name, adapter.maxChargeAttempts, specs, pricing, () =>
    adapter.generate(specs, undefined, signal),
  )
}
async function submitLabels(
  specs: DocumentSpec[],
  drafts: Map<string, GeneratedDocument>,
  adapter: LabelingAdapter,
  pricing: PricingTable,
  signal: AbortSignal,
) {
  const inputs = specs.map((spec) => {
    const draft = drafts.get(spec.id)
    if (!draft || !draft.text.trim())
      throw new Error(`Draft provider omitted source for ${spec.id}`)
    return { spec, text: draft.text }
  })
  return charged(adapter.name, adapter.maxChargeAttempts, specs, pricing, () =>
    adapter.label(inputs, undefined, signal),
  )
}
async function submitRepair(
  spec: DocumentSpec,
  draft: GeneratedDocument,
  adapter: LabelingAdapter,
  feedback: Map<string, string>,
  pricing: PricingTable,
  signal: AbortSignal,
) {
  return charged(adapter.name, adapter.maxChargeAttempts, [spec], pricing, () =>
    adapter.repair([{ spec, text: draft.text }], feedback, undefined, signal),
  )
}

async function charged<T extends ChargedItem>(
  name: string,
  maxAttempts: number,
  specs: Array<{ id: string }>,
  pricing: PricingTable,
  operation: () => Promise<T[]>,
): Promise<ChargedResult<T>> {
  const [provider, model] = name.split(':', 2) as [string, string]
  const rate = pricing[name] ?? pricing[model]
  if (!rate) throw new Error(`No reviewed pricing entry for ${name}`)
  const reservationId = `${name}:${specs[0]?.id}:${Date.now()}`
  const ledgerPath = configuredLedgerPath()
  const ledger = await readLedger(ledgerPath)
  const maximum: Usage = {
    inputTokens:
      specs.length * maximumBillableRequestUsage.inputTokens * maxAttempts,
    outputTokens:
      specs.length * maximumBillableRequestUsage.outputTokens * maxAttempts,
  }
  await reserveSpend(ledgerPath, ledger, {
    provider,
    model,
    ...maximum,
    gbp: costGbp(maximum, rate, gbpPerUsd),
    reservationId,
  })
  let items: T[]
  try {
    items = await operation()
  } catch (error) {
    const partial =
      error instanceof ProviderBatchError
        ? sumUsage(
            error.telemetry.flatMap((entry) =>
              entry.usage ? [entry.usage] : [],
            ),
          )
        : { inputTokens: 0, outputTokens: 0 }
    const partialGbp = costGbp(partial, rate, gbpPerUsd)
    try {
      await reconcileSpend(ledgerPath, ledger, reservationId, {
        provider,
        model,
        ...partial,
        gbp: partialGbp,
      })
    } catch (reconciliationError) {
      throw new ChargedAccountingError(
        'Spend reconciliation failed after a paid provider error',
        partial,
        partialGbp,
        error instanceof ProviderBatchError ? error.telemetry : [],
        { cause: reconciliationError },
      )
    }
    if (error instanceof ProviderBatchError)
      throw new ChargedAccountingError(
        error.message,
        partial,
        partialGbp,
        error.telemetry,
        { cause: error },
      )
    throw error
  }
  const requestTelemetry = items.flatMap((item) => [
    ...(item.retryTelemetry ?? []),
    ...(item.telemetry ? [item.telemetry] : []),
  ])
  let usage: Usage
  try {
    usage = sumUsage(
      items.flatMap((item) => [
        item.usage,
        ...(item.retryTelemetry ?? []).flatMap((entry) =>
          entry.usage ? [entry.usage] : [],
        ),
      ]),
    )
  } catch (error) {
    const evidencedUsage = sumUsage(
      requestTelemetry.flatMap((entry) => (entry.usage ? [entry.usage] : [])),
    )
    throw new ChargedAccountingError(
      'Provider usage accounting failed after a paid response',
      evidencedUsage,
      costGbp(evidencedUsage, rate, gbpPerUsd),
      requestTelemetry,
      { cause: error },
    )
  }
  const actualGbp = costGbp(usage, rate, gbpPerUsd)
  try {
    await reconcileSpend(ledgerPath, ledger, reservationId, {
      provider,
      model,
      ...usage,
      gbp: actualGbp,
    })
  } catch (error) {
    throw new ChargedAccountingError(
      'Spend reconciliation failed after a paid response',
      usage,
      actualGbp,
      requestTelemetry,
      { cause: error },
    )
  }
  if (
    usage.inputTokens > maximum.inputTokens ||
    usage.outputTokens > maximum.outputTokens
  )
    throw new ChargedAccountingError(
      'Paid response exceeded its reviewed usage reservation',
      usage,
      actualGbp,
      requestTelemetry,
    )
  return { items, usage, cost: actualGbp }
}
function appendStateTelemetry(
  state: DocumentProcessingState,
  items: ChargedItem[],
) {
  for (const item of items) {
    if (item.telemetry) state.telemetryRequestIds.push(item.telemetry.requestId)
    state.telemetryRequestIds.push(
      ...(item.retryTelemetry ?? []).map((entry) => entry.requestId),
    )
  }
}
function sumUsage(values: Usage[]) {
  return values.reduce(
    (total, value) => {
      addUsage(total, value)
      return total
    },
    { inputTokens: 0, outputTokens: 0 } satisfies Usage,
  )
}
function addUsage(total: Usage, value: Usage) {
  total.inputTokens += value.inputTokens
  total.outputTokens += value.outputTokens
  total.cacheCreationInputTokens =
    (total.cacheCreationInputTokens ?? 0) +
    (value.cacheCreationInputTokens ?? 0)
  total.cacheReadInputTokens =
    (total.cacheReadInputTokens ?? 0) + (value.cacheReadInputTokens ?? 0)
}
function telemetryCost(entry: RequestTelemetry, pricing: PricingTable) {
  if (!entry.usage || !entry.returnedModel) return 0
  const providerKey = entry.provider
    ? `${entry.provider}:${entry.returnedModel}`
    : undefined
  const rate =
    (providerKey && pricing[providerKey]) ?? pricing[entry.returnedModel]
  return rate ? costGbp(entry.usage, rate, gbpPerUsd) : 0
}
function assertTelemetryModelIdentity(
  telemetry: RequestTelemetry[],
  expected: Record<ProviderRole, string>,
  expectedProviders: Record<ProviderRole, string>,
) {
  for (const entry of telemetry) {
    if (entry.provider !== expectedProviders[entry.role])
      throw new Error(`Telemetry used an unapproved ${entry.role} provider`)
    if (entry.requestedModel !== expected[entry.role])
      throw new Error(`Telemetry requested an unapproved ${entry.role} model`)
    if (
      entry.status === 'success' &&
      entry.returnedModel !== expected[entry.role]
    )
      throw new Error(`Telemetry returned an unapproved ${entry.role} model`)
  }
}
function providerFromAdapter(adapter: { name: string }) {
  const provider = adapter.name.split(':', 1)[0]
  if (!provider) throw new Error('Provider adapter name is malformed')
  return provider
}
export function terminalProgress(scope: string) {
  return (progress: PipelineProgress) => {
    const position = `${progress.completed}/${progress.total}`
    const attempt = progress.attempt ? ` attempt=${progress.attempt}` : ''
    const status = progress.status ? ` status=${progress.status}` : ''
    console.log(
      `[synthetic-v2] ${scope} ${position} ${progress.specId} ${progress.phase}${attempt}${status}`,
    )
  }
}

function requiredModel(name: string) {
  const model = process.env[name]?.trim()
  if (!model)
    throw new Error(`${name} must name an independently configured judge model`)
  return model
}
function configuredJudge(role: 'primary' | 'adjudicator') {
  const prefix =
    role === 'primary'
      ? 'SYNTHETIC_V2_PRIMARY_JUDGE'
      : 'SYNTHETIC_V2_ADJUDICATOR'
  return createJudgeAdapter(
    parseJudgeProvider(process.env[`${prefix}_PROVIDER`], `${prefix}_PROVIDER`),
    requiredModel(`${prefix}_MODEL`),
    role === 'primary' ? 'primary_judge' : 'dispute_judge',
  )
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
function writerAdapter(model: string): GeneratorAdapter {
  return model.startsWith('anthropic/')
    ? new OpenRouterGenerator(model)
    : new DeepSeekGenerator(model)
}
async function loadExternalPartitions(stage: CorpusStage) {
  const path = process.env.SYNTHETIC_V2_PARTITION_REGISTRY
  if (!path)
    throw new Error(
      'SYNTHETIC_V2_PARTITION_REGISTRY is required for cross-partition isolation checks',
    )
  const registry = await loadJson<unknown>(path, 'external partition registry')
  assertExternalPartitionRegistry(registry, stage)
  return {
    manifests: registry.partitions.map((partition) => partition.manifest),
    registryHash: canonicalHash(registry),
  }
}
async function loadSelection() {
  const path = process.env.SYNTHETIC_V2_SELECTION_MANIFEST
  if (!path) throw new Error('SYNTHETIC_V2_SELECTION_MANIFEST is required')
  const value = await loadJson<unknown>(path, 'selection manifest')
  assertSelectionManifest(value)
  return value
}
async function loadTournament() {
  const path = process.env.SYNTHETIC_V2_TOURNAMENT_MANIFEST
  if (!path) throw new Error('SYNTHETIC_V2_TOURNAMENT_MANIFEST is required')
  const value = await loadJson<unknown>(path, 'tournament manifest')
  assertTournamentManifest(value)
  return value
}
async function loadJson<T>(path: string, label: string) {
  try {
    return JSON.parse(await readFile(resolve(path), 'utf8')) as T
  } catch {
    throw new Error(`Could not read ${label}`)
  }
}
function assertNetworkOptIn() {
  if (process.env.OBITER_RUN_SYNTHETIC_V2 !== '1')
    throw new Error(
      'Refusing to call generation APIs. Set OBITER_RUN_SYNTHETIC_V2=1 explicitly; normal tests never call a network API.',
    )
}
function assertDeepSeekTermsConfirmation() {
  if (process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED !== '1')
    throw new Error('DeepSeek terms gate is not confirmed')
}
function requiredFlag(name: string) {
  const value = flag(name)
  if (!value) throw new Error(`Synthetic-v2 requires ${name}`)
  return value
}
function flag(name: string) {
  return process.argv
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
function invokedDirectly() {
  const entry = process.argv[1]
  return Boolean(entry && resolve(entry) === fileURLToPath(import.meta.url))
}
if (invokedDirectly())
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Synthetic-v2 generation failed',
    )
    process.exitCode = 1
  })
