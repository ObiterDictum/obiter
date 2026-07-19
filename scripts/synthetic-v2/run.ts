import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  costGbp,
  readLedger,
  reconcileSpend,
  reserveSpend,
  type PricingTable,
} from './budget'
import { writeDataset, writeText } from './artifacts'
import { buildQuotaSpecs } from './matrix'
import { openRouterBenchmarkModel } from './models'
import { DeepSeekGenerator, OpenRouterGenerator } from './providers'
import type {
  DocumentSpec,
  GenerationProgress,
  GeneratorAdapter,
  SyntheticDocument,
  Usage,
} from './types'
import { supplementMisses } from './qa'
import { nearDuplicatePairs, normalizeGenerated } from './validation'

const capGbp = Number(process.env.SYNTHETIC_V2_CAP_GBP ?? '30')
const gbpPerUsd = Number(process.env.SYNTHETIC_V2_GBP_PER_USD ?? '0.79')
const ledgerPath = resolve(
  process.env.SYNTHETIC_V2_LEDGER ?? '.synthetic-v2/spend-ledger.json',
)
const pricingPath =
  process.env.SYNTHETIC_V2_PRICING_PATH ??
  resolve('scripts/synthetic-v2/pricing-2026-07-19.json')

async function main() {
  const mode = process.argv.includes('--dry-run') ? 'dry-run' : 'full'
  assertNetworkOptIn()
  assertDeepSeekTermsConfirmation()
  const pricing = await loadPricing()
  if (mode === 'dry-run') {
    await runDryRun(pricing)
    return
  }

  const approvedModel = flag('--approved-model')
  if (
    approvedModel !== 'deepseek-v4-pro' &&
    approvedModel !== 'deepseek-v4-flash'
  )
    throw new Error(
      'Full generation is stopped pending the maintainer blind review. Re-run only after approval with --approved-model=deepseek-v4-pro or --approved-model=deepseek-v4-flash.',
    )
  await runFull(approvedModel, pricing)
}

function assertNetworkOptIn() {
  if (process.env.OBITER_RUN_SYNTHETIC_V2 !== '1')
    throw new Error(
      'Refusing to call generation APIs. Set OBITER_RUN_SYNTHETIC_V2=1 explicitly; normal tests never call a network API.',
    )
}

function assertDeepSeekTermsConfirmation() {
  if (process.env.OBITER_DEEPSEEK_TERMS_CONFIRMED !== '1')
    throw new Error(
      'DeepSeek terms gate is not confirmed. Set OBITER_DEEPSEEK_TERMS_CONFIRMED=1 only after recording an account-specific commercial-output and data-retention review; see docs/specs/redact/synthetic-v2-terms-review.md.',
    )
}

async function loadPricing(): Promise<PricingTable> {
  try {
    return JSON.parse(await readFile(pricingPath, 'utf8')) as PricingTable
  } catch (error) {
    throw new Error(
      `Could not read pricing configuration at ${pricingPath}: ${error instanceof Error ? error.message : 'unknown error'}`,
    )
  }
}

async function runDryRun(pricing: PricingTable) {
  const specs = buildQuotaSpecs(10, 'dry')
  const generators: Array<{ blind: string; adapter: GeneratorAdapter }> = [
    { blind: 'A', adapter: new DeepSeekGenerator('deepseek-v4-pro') },
    { blind: 'B', adapter: new DeepSeekGenerator('deepseek-v4-flash') },
    {
      blind: 'C',
      adapter: new OpenRouterGenerator(openRouterBenchmarkModel()),
    },
  ]
  const output = resolve('data/synthetic-v2-review/dry-run')
  const reports: Array<Record<string, unknown>> = []
  const mapping: Record<string, string> = {}

  for (const generator of generators) {
    mapping[generator.blind] = generator.adapter.name
    console.log(
      `[dry-run ${generator.blind}] Starting ${generator.adapter.name}.`,
    )
    const result = await generateAndValidate(
      specs,
      generator.adapter,
      pricing,
      {
        dryRun: true,
        label: `dry-run ${generator.blind}`,
      },
    )
    await writeText(
      resolve(output, `${generator.blind}.jsonl`),
      `${result.documents.map(({ id, text }) => JSON.stringify({ id, text })).join('\n')}\n`,
    )
    reports.push({
      set: generator.blind,
      documents: result.documents.length,
      usage: result.usage,
      measuredCostGbp: result.actualGbp,
      costPerDocumentGbp: Number(
        (result.actualGbp / result.documents.length).toFixed(6),
      ),
      projectedTraining2500Gbp: Number((result.actualGbp * 250).toFixed(2)),
      projectedBenchmark280Gbp: Number((result.actualGbp * 28).toFixed(2)),
      validationDiscards: result.validationDiscards,
      dedupeDiscards: result.dedupeDiscards,
      supplementDiscards: result.supplementDiscards,
    })
  }
  await writeText(
    resolve(output, 'BLIND-REVIEW.md'),
    '# Synthetic v2 blind review\n\nReview prose authenticity in A.jsonl, B.jsonl, and C.jsonl. Provider names and cost mapping are intentionally withheld.\n',
  )
  await writeText(
    resolve('.synthetic-v2/dry-run-provider-map.json'),
    `${JSON.stringify(mapping, null, 2)}\n`,
  )
  await writeText(
    resolve('.synthetic-v2/dry-run-cost-report.json'),
    `${JSON.stringify({ capGbp, reports, projection: 'Multiply measured per-document cost by 2500 for training and 280 for benchmark after blind-review approval.' }, null, 2)}\n`,
  )
}

async function runFull(
  model: 'deepseek-v4-pro' | 'deepseek-v4-flash',
  pricing: PricingTable,
) {
  const train = await generateAndValidate(
    buildQuotaSpecs(2_500, 'train'),
    new DeepSeekGenerator(model),
    pricing,
    { label: 'training' },
  )
  const benchmark = await generateAndValidate(
    buildQuotaSpecs(280, 'bench'),
    new OpenRouterGenerator(openRouterBenchmarkModel()),
    pricing,
    { label: 'benchmark' },
  )
  await writeDataset(
    resolve('data/synthetic/uk-legal-train'),
    train.documents,
    {
      private: true,
      generator: model,
      usage: train.usage,
      spendGbp: train.actualGbp,
      validationDiscards: train.validationDiscards,
      dedupeDiscards: train.dedupeDiscards,
      supplementDiscards: train.supplementDiscards,
    },
  )
  await writeDataset(resolve('data/bench/uk-legal-pii'), benchmark.documents, {
    generator: openRouterBenchmarkModel(),
    public: true,
    usage: benchmark.usage,
    spendGbp: benchmark.actualGbp,
    validationDiscards: benchmark.validationDiscards,
    dedupeDiscards: benchmark.dedupeDiscards,
    supplementDiscards: benchmark.supplementDiscards,
  })
}

type Rejection = {
  id: string
  attempt: number
  reason: string
  markedText: string
}

async function generateAndValidate(
  initialSpecs: DocumentSpec[],
  adapter: GeneratorAdapter,
  pricing: PricingTable,
  options: { dryRun?: boolean; label: string },
) {
  const accepted: SyntheticDocument[] = []
  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  let actualGbp = 0
  let validationDiscards = 0
  let dedupeDiscards = 0
  let supplementDiscards = 0
  let pending = initialSpecs
  const rejections: Rejection[] = []
  let attempt = 0
  while (pending.length) {
    if (attempt++ === 4)
      throw new Error(
        `Marker or dedupe validation did not converge for ${pending.length} documents`,
      )
    console.log(
      `[${options.label}] Validation round ${attempt}: submitting ${pending.length} document(s) to ${adapter.name}.`,
    )
    const submission = await submitWithCap(
      pending,
      adapter,
      pricing,
      (progress) => {
        const detail = progress.specId ? ` (${progress.specId})` : ''
        const retry =
          progress.phase === 'retrying'
            ? `attempt ${progress.attempt}: ${progress.reason}`
            : `${progress.completed}/${progress.total}`
        console.log(`[${options.label}] ${progress.phase}: ${retry}${detail}`)
      },
    )
    addUsage(usage, submission.usage)
    actualGbp += submission.actualGbp
    const generated = submission.documents
    const next: DocumentSpec[] = []
    for (const spec of pending) {
      const result = generated.get(spec.id)
      if (!result) throw new Error(`Provider omitted ${spec.id}`)
      try {
        const document = normalizeGenerated(spec, result)
        if (nearDuplicatePairs([...accepted, document]).length) {
          dedupeDiscards++
          rejections.push({
            id: spec.id,
            attempt,
            reason: 'Near-duplicate document',
            markedText: result.text,
          })
          next.push({ ...spec, seed: `${spec.seed}:dedupe:${attempt}` })
          continue
        }
        if (supplementMisses([document]).length) {
          supplementDiscards++
          rejections.push({
            id: spec.id,
            attempt,
            reason: 'Supplement found an unlabelled detectable identifier',
            markedText: result.text,
          })
          next.push({ ...spec, seed: `${spec.seed}:supplement:${attempt}` })
          continue
        }
        accepted.push(document)
      } catch (error) {
        validationDiscards++
        rejections.push({
          id: spec.id,
          attempt,
          reason:
            error instanceof Error
              ? error.message
              : 'Unknown validation failure',
          markedText: result.text,
        })
        next.push({ ...spec, seed: `${spec.seed}:validation:${attempt}` })
      }
    }
    if (options.dryRun && next.length) {
      const reportPath = resolve(
        '.synthetic-v2/rejections',
        `${adapter.name.replaceAll(/[^a-z0-9]+/gi, '_')}.jsonl`,
      )
      await writeText(
        reportPath,
        `${rejections.map((rejection) => JSON.stringify(rejection)).join('\n')}\n`,
      )
      throw new Error(
        `Dry run stopped: ${next.length}/${pending.length} ${adapter.name} documents failed validation. Evidence written to ${reportPath}. No automatic regeneration was submitted.`,
      )
    }
    pending = next
  }
  return {
    documents: accepted,
    usage,
    actualGbp: Number(actualGbp.toFixed(6)),
    validationDiscards,
    dedupeDiscards,
    supplementDiscards,
  }
}

async function submitWithCap(
  specs: DocumentSpec[],
  adapter: GeneratorAdapter,
  pricing: PricingTable,
  onProgress: (progress: GenerationProgress) => void,
) {
  const model = adapter.name.split(':', 2)[1]
  const modelPricing = pricing[model]
  if (!modelPricing) throw new Error(`No reviewed pricing entry for ${model}`)
  const reservationId = `${adapter.name}:${specs[0]?.id}:${Date.now()}`
  const ledger = await readLedger(ledgerPath, capGbp)
  const maximumUsage: Usage = {
    inputTokens: specs.length * 1_500 * adapter.maxChargeAttempts,
    outputTokens: specs.length * 2_400 * adapter.maxChargeAttempts,
  }
  await reserveSpend(ledgerPath, ledger, {
    provider: adapter.name.split(':', 1)[0]!,
    model,
    ...maximumUsage,
    gbp: costGbp(maximumUsage, modelPricing, gbpPerUsd),
    reservationId,
  })
  const generated = await adapter.generate(specs, onProgress)
  const actualUsage = generated.reduce(
    (total, document) => {
      addUsage(total, document.usage)
      return total
    },
    { inputTokens: 0, outputTokens: 0 } satisfies Usage,
  )
  await reconcileSpend(ledgerPath, ledger, reservationId, {
    provider: adapter.name.split(':', 1)[0]!,
    model,
    ...actualUsage,
    gbp: costGbp(actualUsage, modelPricing, gbpPerUsd),
  })
  return {
    documents: new Map(
      generated.map((document) => [document.customId, document]),
    ),
    usage: actualUsage,
    actualGbp: costGbp(actualUsage, modelPricing, gbpPerUsd),
  }
}

function addUsage(total: Usage, addition: Usage) {
  total.inputTokens += addition.inputTokens
  total.outputTokens += addition.outputTokens
  total.cacheCreationInputTokens =
    (total.cacheCreationInputTokens ?? 0) +
    (addition.cacheCreationInputTokens ?? 0)
  total.cacheReadInputTokens =
    (total.cacheReadInputTokens ?? 0) + (addition.cacheReadInputTokens ?? 0)
}

function flag(name: string) {
  const argument = process.argv.find((value) => value.startsWith(`${name}=`))
  return argument?.slice(name.length + 1)
}

void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Synthetic-v2 generation failed',
  )
  process.exitCode = 1
})
