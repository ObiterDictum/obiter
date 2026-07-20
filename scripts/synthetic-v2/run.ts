import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  costGbp,
  readLedger,
  reconcileSpend,
  reserveSpend,
  type PricingTable,
} from './budget'
import { writeDatasetAtomically } from './artifacts'
import {
  assertApprovedModel,
  assertPartitionManifest,
  assertSelectionManifest,
  assertTournamentManifest,
  canonicalHash,
  requireSelection,
  selectedCandidate,
  type PartitionManifest,
} from './governance'
import { corpusStageSpecs, isCorpusStage, type CorpusStage } from './program'
import { defaultOpenRouterQaModel } from './models'
import { evaluateSpans, hardNegativeFalsePositiveRate } from './metrics'
import {
  OpenRouterGenerator,
  OpenRouterJudge,
  OpenRouterLabeler,
  DeepSeekGenerator,
  ProviderBatchError,
} from './providers'
import { reviewDocuments, supplementMisses } from './qa'
import type {
  DocumentSpec,
  GeneratedDocument,
  GeneratorAdapter,
  JudgeAdapter,
  LabelingAdapter,
  RequestTelemetry,
  SyntheticDocument,
  Usage,
} from './types'
import { NearDuplicateIndex, normalizeAnnotated } from './validation'

const gbpPerUsd = Number(process.env.SYNTHETIC_V2_GBP_PER_USD ?? '0.79')
const ledgerPath = resolve(
  process.env.SYNTHETIC_V2_LEDGER ?? '.synthetic-v2/spend-ledger.json',
)
const pricingPath =
  process.env.SYNTHETIC_V2_PRICING_PATH ??
  resolve('scripts/synthetic-v2/pricing-2026-07-19.json')

export type PipelineResult = {
  documents: SyntheticDocument[]
  qa: Awaited<ReturnType<typeof reviewDocuments>>
  usage: Usage
  actualGbp: number
  requestTelemetry: RequestTelemetry[]
}

async function main() {
  const stage = flag('--stage')
  if (!isCorpusStage(stage))
    throw new Error(
      'Select an explicit stage: --stage=tournament, training_seed, development_challenge, or benchmark.',
    )
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
  const primary = new OpenRouterJudge(candidate.annotator)
  const dispute = new OpenRouterJudge(candidate.annotator, {}, 'dispute_judge')
  const external = await loadExternalPartitions(stage)
  const result = await runPipeline(
    corpusStageSpecs(stage),
    writer,
    labeler,
    primary,
    dispute,
    pricing,
    external,
  )
  assertApprovedModel(
    selection,
    'writer',
    candidate.writer,
    modelFromAdapterOutput(result.documents[0]?.generator),
  )
  assertApprovedModel(
    selection,
    'annotator',
    candidate.annotator,
    annotationModel(result.requestTelemetry),
  )
  const privateRoot =
    process.env.SYNTHETIC_V2_PRIVATE_CORPUS_ROOT ??
    '../obiter-redaction-data-private'
  const outputStage = stage === 'benchmark' ? 'benchmark_candidate' : stage
  await writeDatasetAtomically(result.documents, {
    root: privateRoot,
    productRoot: process.cwd(),
    rootKind: 'private-corpus',
    stage: outputStage,
    metadata: {
      version: 'synthetic-v2-run:v1',
      stage,
      selection,
      tournamentManifestHash: tournament.manifestHash,
      qa: [...result.qa].map(([id, evidence]) => ({ id, ...evidence })),
      usage: result.usage,
      spendGbp: result.actualGbp,
      requestTelemetry: result.requestTelemetry,
      externalPartitionHashes: external.map((manifest) =>
        canonicalHash(manifest),
      ),
    },
  })
}

/** Shared runner used by offline fake-adapter tests; it never creates adapters or does I/O. */
export async function runPipeline(
  specs: DocumentSpec[],
  writer: GeneratorAdapter,
  labeler: LabelingAdapter,
  primaryJudge: JudgeAdapter,
  disputeJudge: JudgeAdapter,
  pricing: PricingTable,
  externalPartitions: PartitionManifest[] = [],
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
  try {
    const drafts = await submitDocuments(
      specs,
      writer,
      pricing,
      'writer',
      abort.signal,
    )
    consume(drafts, usage, telemetry)
    actualGbp += drafts.cost
    const labels = await submitLabels(
      specs,
      drafts.documents,
      labeler,
      pricing,
      abort.signal,
    )
    consume(labels, usage, telemetry)
    actualGbp += labels.cost
    const accepted: SyntheticDocument[] = []
    for (const spec of specs) {
      const draft = drafts.documents.get(spec.id)
      const label = labels.documents.get(spec.id)
      if (!draft || !label) throw new Error(`Provider omitted ${spec.id}`)
      const document = normalizeAnnotated(spec, draft, label.spans)
      if (externalHashes.has(document.contentHash))
        throw new Error(
          `Cross-partition exact hash collision for ${document.id}`,
        )
      const duplicate = index.check(document)
      if (duplicate)
        throw new Error(
          `Near-duplicate document ${document.id} matches ${duplicate.right} at ${duplicate.similarity}`,
        )
      const misses = supplementMisses([document])
      if (misses.length)
        throw new Error(`Supplement found unlabelled spans for ${document.id}`)
      index.add(document)
      accepted.push(document)
    }
    const qa = await reviewDocuments(
      accepted,
      primaryJudge,
      disputeJudge,
      abort.signal,
    )
    for (const [id, evidence] of qa) {
      for (const entry of [
        evidence.primaryTelemetry,
        evidence.disputeTelemetry,
      ]) {
        if (!entry) continue
        telemetry.push(entry)
        if (entry.usage) {
          addUsage(usage, entry.usage)
          actualGbp += telemetryCost(entry, pricing)
        }
      }
      if (!evidence.accepted)
        throw new Error(`QA rejected ${id}; candidate cannot be accepted`)
    }
    return {
      documents: accepted,
      qa,
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

async function runTournament(pricing: PricingTable) {
  const specs = corpusStageSpecs('tournament')
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
  const outputs = [] as Array<{
    candidateId: string
    specificationIds: string[]
    seeds: string[]
    canonicalArtifactHash: string
    blindReviewScorecardHash: string
    finalStatus: 'pending_review'
  }>
  const candidateArtifacts: unknown[] = []
  for (const candidate of candidates) {
    const result = await runPipeline(
      specs,
      writerAdapter(candidate.writer),
      new OpenRouterLabeler(candidate.annotator),
      new OpenRouterJudge(candidate.annotator),
      new OpenRouterJudge(candidate.annotator, {}, 'dispute_judge'),
      pricing,
    )
    const qa = [...result.qa]
    const hardNegatives = result.documents.reduce(
      (total, document) => total + (document.hardNegatives?.length ?? 0),
      0,
    )
    const artifact = {
      candidateId: candidate.id,
      specs: specs.map(({ id, seed }) => ({ id, seed })),
      documents: result.documents,
      qa,
      metrics: {
        entity: evaluateSpans(
          result.documents.map((document) => ({
            id: document.id,
            gold: document.spans,
            predicted: document.spans,
          })),
        ),
        hardNegativeFalsePositiveRate: hardNegativeFalsePositiveRate(
          hardNegatives,
          qa.filter(([, evidence]) => !evidence.primary.hardNegativesCorrect)
            .length,
        ),
      },
      usage: result.usage,
      spendGbp: result.actualGbp,
      requestTelemetry: result.requestTelemetry,
    }
    candidateArtifacts.push(artifact)
    outputs.push({
      candidateId: candidate.id,
      specificationIds: specs.map((spec) => spec.id),
      seeds: specs.map((spec) => spec.seed),
      canonicalArtifactHash: canonicalHash(artifact),
      blindReviewScorecardHash: canonicalHash({
        candidateId: candidate.id,
        status: 'pending-blind-human-review',
      }),
      finalStatus: 'pending_review',
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
      blindedReviewArtifacts: outputs.map(
        ({ candidateId, blindReviewScorecardHash }) => ({
          blindId: canonicalHash(candidateId).slice(0, 8),
          blindReviewScorecardHash,
        }),
      ),
    },
  })
}

async function submitDocuments(
  specs: DocumentSpec[],
  adapter: GeneratorAdapter,
  pricing: PricingTable,
  role: 'writer',
  signal: AbortSignal,
) {
  const documents = await charged(
    adapter.name,
    adapter.maxChargeAttempts,
    specs,
    pricing,
    role,
    () => adapter.generate(specs, undefined, signal),
  )
  return {
    documents: new Map(documents.items.map((item) => [item.customId, item])),
    ...documents,
  }
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
  const annotations = await charged(
    adapter.name,
    adapter.maxChargeAttempts,
    specs,
    pricing,
    'annotator',
    () => adapter.label(inputs, undefined, signal),
  )
  return {
    documents: new Map(annotations.items.map((item) => [item.customId, item])),
    ...annotations,
  }
}

async function charged<
  T extends { usage: Usage; telemetry?: RequestTelemetry },
>(
  name: string,
  maxAttempts: number,
  specs: DocumentSpec[],
  pricing: PricingTable,
  _role: string,
  operation: () => Promise<T[]>,
) {
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
    const usage = sumUsage(items.map((item) => item.usage))
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
function consume(
  value: { items: Array<{ telemetry?: RequestTelemetry }>; usage: Usage },
  total: Usage,
  telemetry: RequestTelemetry[],
) {
  addUsage(total, value.usage)
  telemetry.push(
    ...value.items.flatMap((item) => (item.telemetry ? [item.telemetry] : [])),
  )
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
function writerAdapter(model: string): GeneratorAdapter {
  return model.startsWith('anthropic/')
    ? new OpenRouterGenerator(model)
    : new DeepSeekGenerator(model)
}
function modelFromAdapterOutput(value: string | undefined) {
  return value?.split(':', 2)[1]
}
function annotationModel(telemetry: RequestTelemetry[]) {
  return telemetry.find((entry) => entry.role === 'annotator')?.returnedModel
}
async function loadExternalPartitions(stage: CorpusStage) {
  const paths = (process.env.SYNTHETIC_V2_EXTERNAL_PARTITION_MANIFESTS ?? '')
    .split(',')
    .filter(Boolean)
  if (stage !== 'tournament' && paths.length === 0)
    throw new Error(
      'Explicit external partition manifests are required for isolation checks',
    )
  return Promise.all(
    paths.map(async (path) => {
      const value = await loadJson<unknown>(path, 'external partition manifest')
      assertPartitionManifest(value)
      if ((value as PartitionManifest).stage === stage)
        throw new Error(
          'External partition manifest cannot be the candidate stage',
        )
      return value as PartitionManifest
    }),
  )
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
function flag(name: string) {
  return process.argv
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Synthetic-v2 generation failed',
  )
  process.exitCode = 1
})
