import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'
import {
  costGbp,
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
  assertApprovedModel,
  assertExternalPartitionRegistry,
  blindReviewPackage,
  assertPartitionManifest,
  assertSelectionManifest,
  assertTournamentManifest,
  canonicalHash,
  requireSelection,
  selectedCandidate,
  type PartitionManifest,
} from './governance'
import { assertTournamentStratification } from './matrix'
import { defaultOpenRouterQaModel } from './models'
import { scoreAdjudicatedDocuments } from './scoring'
import { corpusStageSpecs, isCorpusStage, type CorpusStage } from './program'
import {
  DeepSeekGenerator,
  OpenRouterGenerator,
  OpenRouterJudge,
  OpenRouterLabeler,
  ProviderBatchError,
} from './providers'
import {
  applyAdjudicatedReference,
  reviewDocuments,
  validateHumanAdjudication,
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
import {
  NearDuplicateIndex,
  contentHash,
  normalizeAnnotated,
} from './validation'

const gbpPerUsd = Number(process.env.SYNTHETIC_V2_GBP_PER_USD ?? '0.79')
const ledgerPath = resolve(
  process.env.SYNTHETIC_V2_LEDGER ?? '.synthetic-v2/spend-ledger.json',
)
const pricingPath =
  process.env.SYNTHETIC_V2_PRICING_PATH ??
  resolve('scripts/synthetic-v2/pricing-2026-07-19.json')

type DocumentProcessingState = {
  id: string
  status:
    'accepted' | 'repair_required' | 'human_adjudication_required' | 'failed'
  generationAttempts: number
  annotationAttempts: number
  repairAttempts: number
  regenerationAttempts: number
  qaAttempts: number
  transitions: Array<{ phase: string; reason?: string }>
  telemetryRequestIds: string[]
}

export type PendingAdjudication = {
  document: SyntheticDocument
  evidence: QaEvidence
  state: DocumentProcessingState
}

export type PendingAdjudicationArtifact = {
  version: 'synthetic-v2-pending-adjudication:v1'
  stage: CorpusStage
  pending: PendingAdjudication[]
  artifactHash: string
}

export type PipelineResult = {
  documents: SyntheticDocument[]
  /** Initial annotation predictions, retained even when later repaired. */
  firstPassAnnotations: Map<string, SyntheticDocument['spans']>
  pendingAdjudications: PendingAdjudication[]
  qa: Map<string, QaEvidence>
  documentStates: DocumentProcessingState[]
  usage: Usage
  actualGbp: number
  requestTelemetry: RequestTelemetry[]
}

export type PipelineOptions = {
  requireIndependentAdjudication?: boolean
  maxRegenerations?: number
  humanAdjudications?: Map<string, HumanAdjudication>
}

export function pendingAdjudicationArtifact(
  stage: CorpusStage,
  pending: PendingAdjudication[],
): PendingAdjudicationArtifact {
  if (!pending.length) throw new Error('Pending adjudication artifact is empty')
  const unsigned = {
    version: 'synthetic-v2-pending-adjudication:v1' as const,
    stage,
    pending,
  }
  return { ...unsigned, artifactHash: canonicalHash(unsigned) }
}

export function resumePendingAdjudications(
  artifact: PendingAdjudicationArtifact,
  dispositions: HumanAdjudication[],
) {
  const { artifactHash, ...unsigned } = artifact
  if (
    artifact.version !== 'synthetic-v2-pending-adjudication:v1' ||
    !isCorpusStage(artifact.stage) ||
    canonicalHash(unsigned) !== artifactHash
  )
    throw new Error('Pending adjudication artifact is stale or invalid')
  const pending = new Map(
    artifact.pending.map((entry) => [entry.document.id, entry]),
  )
  if (pending.size !== artifact.pending.length)
    throw new Error('Pending adjudication artifact has duplicate documents')
  const dispositionById = new Map(
    dispositions.map((entry) => [entry.id, entry]),
  )
  if (
    dispositionById.size !== dispositions.length ||
    dispositionById.size !== pending.size
  )
    throw new Error(
      'Human dispositions do not exactly match pending adjudications',
    )
  const accepted: SyntheticDocument[] = []
  const rejected: string[] = []
  for (const [id, entry] of pending) {
    const human = dispositionById.get(id)
    if (!human) throw new Error(`Missing human disposition for ${id}`)
    if (entry.document.contentHash !== contentHash(entry.document.text))
      throw new Error(`Pending adjudication document hash is invalid for ${id}`)
    const evidence = {
      ...entry.evidence,
      human,
      outcome:
        human.decision === 'approved'
          ? ('accepted' as const)
          : ('human_rejected' as const),
      accepted: human.decision === 'approved',
      adjudicatedReference:
        human.decision === 'approved'
          ? { source: 'human' as const, spans: human.referenceSpans }
          : undefined,
    }
    // reviewDocuments performs this same binding during a live run.
    if (!entry.evidence.dispute)
      throw new Error(`Pending adjudication lacks dispute evidence for ${id}`)
    validateHumanAdjudication(
      entry.document,
      entry.evidence.primary,
      entry.evidence.dispute,
      human,
    )
    if (human.decision === 'approved')
      accepted.push(applyAdjudicatedReference(entry.document, evidence))
    else rejected.push(id)
  }
  return { stage: artifact.stage, accepted, rejected }
}

export async function persistPendingAdjudications(
  root: string,
  productRoot: string,
  artifact: PendingAdjudicationArtifact,
) {
  const approvedRoot = await assertSafeOutputRoot(
    root,
    productRoot,
    'private-corpus',
    'training_seed',
  )
  const destination = resolve(
    approvedRoot,
    'pending-adjudication',
    `${artifact.artifactHash}.json`,
  )
  await writeText(destination, `${JSON.stringify(artifact)}\n`)
  return destination
}

export async function main() {
  const stage = flag('--stage')
  if (!isCorpusStage(stage))
    throw new Error(
      'Select an explicit stage: --stage=tournament, training_seed, development_challenge, or benchmark.',
    )
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
    const resumed = resumePendingAdjudications(artifact, dispositions)
    if (resumed.rejected.length)
      throw new Error(
        'Human adjudication rejected one or more pending documents',
      )
    const privateRoot =
      process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
      '../obiter-redaction-data-private'
    await writeDatasetAtomically(resumed.accepted, {
      root: privateRoot,
      productRoot: process.cwd(),
      rootKind: 'private-corpus',
      stage:
        resumed.stage === 'benchmark' ? 'benchmark_candidate' : resumed.stage,
      metadata: {
        stage: resumed.stage,
        version: 'synthetic-v2-resumed-adjudication:v1',
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
  const primary = new OpenRouterJudge(
    requiredModel('SYNTHETIC_V2_PRIMARY_JUDGE_MODEL'),
  )
  const dispute = new OpenRouterJudge(
    requiredModel('SYNTHETIC_V2_ADJUDICATOR_MODEL'),
    {},
    'dispute_judge',
  )
  assertDistinctRoleModels(candidate.annotator, primary.model, dispute.model)
  const external = await loadExternalPartitions(stage)
  const result = await runPipeline(
    corpusStageSpecs(stage),
    writer,
    labeler,
    primary,
    dispute,
    pricing,
    external.manifests,
    { requireIndependentAdjudication: stage === 'benchmark' },
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
  if (result.pendingAdjudications.length) {
    const artifact = pendingAdjudicationArtifact(
      stage,
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
    metadata: {
      version: 'synthetic-v2-run:v2',
      stage,
      selection,
      tournamentManifestHash: tournament.manifestHash,
      qa: [...result.qa].map(([id, evidence]) => ({ id, ...evidence })),
      firstPassAnnotations: [...result.firstPassAnnotations],
      documentStates: result.documentStates,
      usage: result.usage,
      spendGbp: result.actualGbp,
      requestTelemetry: result.requestTelemetry,
      partitionRegistryHash: external.registryHash,
      externalPartitionHashes: external.manifests.map((manifest) =>
        canonicalHash(manifest),
      ),
    },
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
  const pendingAdjudications: PendingAdjudication[] = []
  const qa = new Map<string, QaEvidence>()
  const documentStates: DocumentProcessingState[] = []
  const maxRegenerations = options.maxRegenerations ?? 2
  assertConfiguredPricing(pricing, [
    writer,
    labeler,
    primaryJudge,
    disputeJudge,
  ])
  const meteredPrimaryJudge = meteredJudge(primaryJudge, pricing)
  const meteredDisputeJudge = meteredJudge(disputeJudge, pricing)
  if (!Number.isInteger(maxRegenerations) || maxRegenerations < 0)
    throw new Error('maxRegenerations must be a non-negative integer')

  const consumeCharged = (value: ChargedResult) => {
    addUsage(usage, value.usage)
    actualGbp += value.cost
    collectItemTelemetry(value.items, telemetry)
  }
  const consumeQa = (evidence: QaEvidence, state: DocumentProcessingState) => {
    for (const entry of [
      evidence.primaryTelemetry,
      evidence.disputeTelemetry,
    ]) {
      if (!entry) continue
      telemetry.push(entry)
      state.telemetryRequestIds.push(entry.requestId)
      if (entry.usage) {
        addUsage(usage, entry.usage)
        actualGbp += telemetryCost(entry, pricing)
      }
    }
  }

  try {
    for (const spec of specs) {
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

        state.qaAttempts++
        state.transitions.push({ phase: 'judge' })
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
    }
    assertTelemetryModelIdentity(telemetry, {
      writer: writer.model,
      annotator: labeler.model,
      primary_judge: primaryJudge.model,
      dispute_judge: disputeJudge.model,
    })
    return {
      documents,
      firstPassAnnotations,
      pendingAdjudications,
      qa,
      documentStates,
      usage,
      actualGbp: Number(actualGbp.toFixed(6)),
      requestTelemetry: telemetry,
    }
  } catch (error) {
    abort.abort(error)
    if (error instanceof ProviderBatchError) telemetry.push(...error.telemetry)
    throw error
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
  const candidates = [
    {
      id: 'deepseek-pro-haiku',
      writer: 'deepseek-v4-pro',
      annotator: defaultOpenRouterQaModel,
    },
    {
      id: 'deepseek-flash-haiku',
      writer: 'deepseek-v4-flash',
      annotator: defaultOpenRouterQaModel,
    },
    {
      id: 'opus-haiku',
      writer: 'anthropic/claude-opus-4.8',
      annotator: defaultOpenRouterQaModel,
    },
  ]
  const outputs: Array<{
    candidateId: string
    blindId: string
    specificationIds: string[]
    seeds: string[]
    canonicalArtifactHash: string
    blindReviewPackageHash: string
    finalStatus: 'pending_review' | 'rejected'
  }> = []
  const candidateArtifacts: unknown[] = []
  const blindReviewPackages: unknown[] = []
  const primaryModel = requiredModel('SYNTHETIC_V2_PRIMARY_JUDGE_MODEL')
  const disputeModel = requiredModel('SYNTHETIC_V2_ADJUDICATOR_MODEL')
  for (const candidate of candidates) {
    let artifact: unknown
    let blindPackage: ReturnType<typeof blindReviewPackage> | undefined
    try {
      assertDistinctRoleModels(candidate.annotator, primaryModel, disputeModel)
      const result = await runPipeline(
        specs,
        writerAdapter(candidate.writer),
        new OpenRouterLabeler(candidate.annotator),
        new OpenRouterJudge(primaryModel),
        new OpenRouterJudge(disputeModel, {}, 'dispute_judge'),
        pricing,
        [],
        { requireIndependentAdjudication: true },
      )
      if (result.documentStates.some((state) => state.status !== 'accepted'))
        throw new Error('Candidate has unresolved documents')
      artifact = {
        candidateId: candidate.id,
        specs: specs.map(({ id, seed }) => ({ id, seed })),
        documents: result.documents,
        qa: [...result.qa],
        metrics: scoreAdjudicatedDocuments(
          result.documents,
          result.qa,
          result.firstPassAnnotations,
        ),
        usage: result.usage,
        spendGbp: result.actualGbp,
        requestTelemetry: result.requestTelemetry,
        documentStates: result.documentStates,
        firstPassAnnotations: [...result.firstPassAnnotations],
      }
      blindPackage = blindReviewPackage(
        `review-${outputs.length + 1}`,
        result.documents,
      )
    } catch (error) {
      artifact = {
        candidateId: candidate.id,
        specs: specs.map(({ id, seed }) => ({ id, seed })),
        status: 'failed',
        error:
          error instanceof Error ? error.message : 'Unknown candidate failure',
      }
    }
    candidateArtifacts.push(artifact)
    if (blindPackage) blindReviewPackages.push(blindPackage)
    outputs.push({
      candidateId: candidate.id,
      blindId: `review-${outputs.length + 1}`,
      specificationIds: specs.map((spec) => spec.id),
      seeds: specs.map((spec) => spec.seed),
      canonicalArtifactHash: canonicalHash(artifact),
      blindReviewPackageHash: canonicalHash(
        blindPackage ?? { status: 'ineligible' },
      ),
      finalStatus: blindPackage ? 'pending_review' : 'rejected',
    })
  }
  const unsigned = {
    version: 'synthetic-v2-tournament:v1' as const,
    candidates: outputs,
  }
  const manifest = { ...unsigned, manifestHash: canonicalHash(unsigned) }
  const root =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  await writeDatasetAtomically([], {
    root,
    productRoot: process.cwd(),
    rootKind: 'private-corpus',
    stage: 'tournament',
    metadata: {
      stage: 'tournament',
      tournament: manifest,
      candidateArtifacts,
      blindReviewPackages,
    },
  })
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
  adapters: Array<{ model: string }>,
) {
  for (const adapter of adapters)
    if (!pricing[adapter.model])
      throw new Error(`No reviewed pricing entry for ${adapter.model}`)
}

function meteredJudge(
  adapter: JudgeAdapter,
  pricing: PricingTable,
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
  const rate = pricing[model]
  if (!rate) throw new Error(`No reviewed pricing entry for ${model}`)
  const reservationId = `${name}:${specs[0]?.id}:${Date.now()}`
  const ledger = await readLedger(ledgerPath)
  const maximum: Usage = {
    inputTokens: specs.length * 1500 * maxAttempts,
    outputTokens: specs.length * 2400 * maxAttempts,
  }
  await reserveSpend(ledgerPath, ledger, {
    provider,
    model,
    ...maximum,
    gbp: costGbp(maximum, rate, gbpPerUsd),
    reservationId,
  })
  try {
    const items = await operation()
    const usage = sumUsage(
      items.flatMap((item) => [
        item.usage,
        ...(item.retryTelemetry ?? []).flatMap((entry) =>
          entry.usage ? [entry.usage] : [],
        ),
      ]),
    )
    await reconcileSpend(ledgerPath, ledger, reservationId, {
      provider,
      model,
      ...usage,
      gbp: costGbp(usage, rate, gbpPerUsd),
    })
    return { items, usage, cost: costGbp(usage, rate, gbpPerUsd) }
  } catch (error) {
    const partial =
      error instanceof ProviderBatchError
        ? sumUsage(
            error.telemetry.flatMap((entry) =>
              entry.usage ? [entry.usage] : [],
            ),
          )
        : { inputTokens: 0, outputTokens: 0 }
    await reconcileSpend(ledgerPath, ledger, reservationId, {
      provider,
      model,
      ...partial,
      gbp: costGbp(partial, rate, gbpPerUsd),
    })
    throw error
  }
}
function collectItemTelemetry(
  items: ChargedItem[],
  telemetry: RequestTelemetry[],
) {
  for (const item of items) {
    if (item.telemetry) telemetry.push(item.telemetry)
    telemetry.push(...(item.retryTelemetry ?? []))
  }
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
  if (!entry.usage || !entry.returnedModel || !pricing[entry.returnedModel])
    return 0
  return costGbp(entry.usage, pricing[entry.returnedModel], gbpPerUsd)
}
function assertTelemetryModelIdentity(
  telemetry: RequestTelemetry[],
  expected: Record<ProviderRole, string>,
) {
  for (const entry of telemetry) {
    if (entry.requestedModel !== expected[entry.role])
      throw new Error(`Telemetry requested an unapproved ${entry.role} model`)
    if (
      entry.status === 'success' &&
      entry.returnedModel !== expected[entry.role]
    )
      throw new Error(`Telemetry returned an unapproved ${entry.role} model`)
  }
}
function requiredModel(name: string) {
  const model = process.env[name]?.trim()
  if (!model)
    throw new Error(`${name} must name an independently configured judge model`)
  return model
}
function assertDistinctRoleModels(
  annotator: string,
  primary: string,
  dispute: string,
) {
  if (new Set([annotator, primary, dispute]).size !== 3)
    throw new Error(
      'Annotator, primary judge, and dispute judge must use distinct model identities',
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
