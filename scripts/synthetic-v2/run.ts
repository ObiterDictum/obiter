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
import { openRouterBenchmarkModel, openRouterQaModel } from './models'
import {
  DeepSeekGenerator,
  OpenRouterGenerator,
  OpenRouterLabeler,
} from './providers'
import type {
  DocumentSpec,
  GenerationProgress,
  GeneratorAdapter,
  LabelingAdapter,
  SyntheticDocument,
  Usage,
} from './types'
import { supplementMisses } from './qa'
import { nearDuplicatePairs, normalizeAnnotated } from './validation'

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
  const specs = buildQuotaSpecs(
    Number(process.env.SYNTHETIC_V2_DRY_RUN_COUNT ?? '3'),
    'dry',
  )
  const generators: Array<{ blind: string; adapter: GeneratorAdapter }> = [
    { blind: 'A', adapter: new DeepSeekGenerator('deepseek-v4-pro') },
    { blind: 'B', adapter: new DeepSeekGenerator('deepseek-v4-flash') },
    {
      blind: 'C',
      adapter: new OpenRouterGenerator(openRouterBenchmarkModel()),
    },
  ]
  const output = resolve('data/synthetic-v2-review/dry-run')
  const labeler = new OpenRouterLabeler(openRouterQaModel())
  const reports: Array<Record<string, unknown>> = []
  const failures: Array<{ set: string; reason: string }> = []
  const mapping: Record<string, string> = {}

  for (const generator of generators) {
    mapping[generator.blind] = generator.adapter.name
    console.log(
      `[dry-run ${generator.blind}] Starting ${generator.adapter.name}.`,
    )
    try {
      const result = await generateAndValidate(
        specs,
        generator.adapter,
        labeler,
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
        projectedTraining2500Gbp: Number(
          ((result.actualGbp / result.documents.length) * 2_500).toFixed(2),
        ),
        projectedBenchmark280Gbp: Number(
          ((result.actualGbp / result.documents.length) * 280).toFixed(2),
        ),
        validationDiscards: result.validationDiscards,
        dedupeDiscards: result.dedupeDiscards,
        supplementDiscards: result.supplementDiscards,
      })
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Unknown failure'
      failures.push({ set: generator.blind, reason })
      reports.push({ set: generator.blind, error: reason })
      console.error(`[dry-run ${generator.blind}] ${reason}`)
    }
  }
  await writeText(
    resolve(output, 'BLIND-REVIEW.md'),
    '# Synthetic v2 blind pilot\n\nReview prose authenticity in A.jsonl, B.jsonl, and C.jsonl. Provider names and cost mapping are intentionally withheld. This three-document pilot must pass before the ten-document blind comparison.\n',
  )
  await writeText(
    resolve('.synthetic-v2/dry-run-provider-map.json'),
    `${JSON.stringify(mapping, null, 2)}\n`,
  )
  await writeText(
    resolve('.synthetic-v2/dry-run-cost-report.json'),
    `${JSON.stringify({ capGbp, reports, projection: 'Multiply measured per-document cost by 2500 for training and 280 for benchmark after blind-review approval.' }, null, 2)}\n`,
  )
  if (failures.length)
    throw new Error(
      `Dry-run validation failed for ${failures.map((failure) => failure.set).join(', ')}. All routes were attempted; inspect their rejection evidence and the cost report.`,
    )
}

async function runFull(
  model: 'deepseek-v4-pro' | 'deepseek-v4-flash',
  pricing: PricingTable,
) {
  const train = await generateAndValidate(
    buildQuotaSpecs(2_500, 'train'),
    new DeepSeekGenerator(model),
    new OpenRouterLabeler(openRouterQaModel()),
    pricing,
    { label: 'training' },
  )
  const benchmark = await generateAndValidate(
    buildQuotaSpecs(280, 'bench'),
    new OpenRouterGenerator(openRouterBenchmarkModel()),
    new OpenRouterLabeler(openRouterQaModel()),
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
  labeler: LabelingAdapter,
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
    const labelSubmission = await submitLabelsWithCap(
      pending,
      submission.documents,
      labeler,
      pricing,
      (progress) => {
        const detail = progress.specId ? ` (${progress.specId})` : ''
        console.log(
          `[${options.label}] labelling ${progress.phase}: ${progress.completed}/${progress.total}${detail}`,
        )
      },
    )
    addUsage(usage, labelSubmission.usage)
    actualGbp += labelSubmission.actualGbp
    const generated = labelSubmission.documents
    const next: DocumentSpec[] = []
    for (const spec of pending) {
      const result = generated.get(spec.id)
      const draft = submission.documents.get(spec.id)
      if (!result || !draft) throw new Error(`Provider omitted ${spec.id}`)
      try {
        const document = normalizeAnnotated(spec, draft, result.spans)
        if (nearDuplicatePairs([...accepted, document]).length) {
          dedupeDiscards++
          rejections.push({
            id: spec.id,
            attempt,
            reason: 'Near-duplicate document',
            markedText: draft.text,
          })
          next.push({ ...spec, seed: `${spec.seed}:dedupe:${attempt}` })
          continue
        }
        const unlabelledSupplementSpans = supplementMisses([document]).filter(
          (miss) =>
            !(
              miss.category === 'case_reference' &&
              spec.hardNegatives.some((negative) =>
                negative.toLowerCase().includes('claim number'),
              )
            ),
        )
        if (unlabelledSupplementSpans.length)
          throw new Error(
            `Supplement found unlabelled spans: ${unlabelledSupplementSpans.map((miss) => `${miss.category}=${JSON.stringify(miss.text)}`).join(', ')}`,
          )
        accepted.push(document)
      } catch (error) {
        const initialReason =
          error instanceof Error ? error.message : 'Unknown validation failure'
        if (!initialReason.startsWith('Supplement found unlabelled spans:')) {
          validationDiscards++
          rejections.push({
            id: spec.id,
            attempt,
            reason: initialReason,
            markedText: draft.text,
          })
          next.push({ ...spec, seed: `${spec.seed}:draft:${attempt}` })
          continue
        }

        let repairText = draft.text
        try {
          console.log(`[${options.label}] repairing labels for ${spec.id}.`)
          const repair = await submitLabelsWithCap(
            [spec],
            submission.documents,
            labeler,
            pricing,
            (progress) =>
              console.log(
                `[${options.label}] repair ${progress.phase}: ${progress.completed}/${progress.total}`,
              ),
            new Map([[spec.id, initialReason]]),
          )
          addUsage(usage, repair.usage)
          actualGbp += repair.actualGbp
          const repaired = repair.documents.get(spec.id)
          if (!repaired) throw new Error('Repair label response was missing')
          let repairedDocument = normalizeAnnotated(spec, draft, repaired.spans)
          const remainingMisses = supplementMisses([repairedDocument])
          if (remainingMisses.length) {
            const remainingFeedback = `Supplement found unlabelled spans: ${remainingMisses.map((miss) => `${miss.category}=${JSON.stringify(miss.text)}`).join(', ')}`
            console.log(
              `[${options.label}] repairing remaining labels for ${spec.id}.`,
            )
            const finalRepair = await submitLabelsWithCap(
              [spec],
              new Map([[spec.id, draft]]),
              labeler,
              pricing,
              (progress) =>
                console.log(
                  `[${options.label}] final repair ${progress.phase}: ${progress.completed}/${progress.total}`,
                ),
              new Map([[spec.id, remainingFeedback]]),
            )
            addUsage(usage, finalRepair.usage)
            actualGbp += finalRepair.actualGbp
            const finalDocument = finalRepair.documents.get(spec.id)
            if (!finalDocument)
              throw new Error('Final repair label response was missing')
            repairedDocument = normalizeAnnotated(
              spec,
              draft,
              finalDocument.spans,
            )
          }
          if (supplementMisses([repairedDocument]).length)
            throw new Error('Repair left an unlabelled detectable identifier')
          accepted.push(repairedDocument)
        } catch (repairError) {
          validationDiscards++
          rejections.push({
            id: spec.id,
            attempt,
            reason: `${initialReason}; repair failed: ${repairError instanceof Error ? repairError.message : 'unknown failure'}`,
            markedText: repairText,
          })
          next.push({ ...spec, seed: `${spec.seed}:validation:${attempt}` })
        }
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

async function submitLabelsWithCap(
  specs: DocumentSpec[],
  drafts: Map<string, { text: string }>,
  labeler: LabelingAdapter,
  pricing: PricingTable,
  onProgress: (progress: GenerationProgress) => void,
  repairFeedback?: Map<string, string>,
) {
  const inputs = specs.map((spec) => {
    const draft = drafts.get(spec.id)
    if (!draft || draft.text.trim().length === 0)
      throw new Error(`Draft provider returned empty text for ${spec.id}`)
    const minimumWords = Math.floor(spec.lengthWords * 0.45)
    const words = draft.text.trim().split(/\s+/).length
    if (words < minimumWords)
      throw new Error(
        `Draft provider returned only ${words}/${minimumWords} minimum words for ${spec.id}`,
      )
    return { spec, text: draft.text }
  })
  const model = labeler.name.split(':', 2)[1]
  const modelPricing = pricing[model]
  if (!modelPricing) throw new Error(`No reviewed pricing entry for ${model}`)
  const reservationId = `${labeler.name}:${specs[0]?.id}:${Date.now()}`
  const ledger = await readLedger(ledgerPath, capGbp)
  const maximumUsage: Usage = {
    inputTokens: specs.length * 1_500 * labeler.maxChargeAttempts,
    outputTokens: specs.length * 2_400 * labeler.maxChargeAttempts,
  }
  await reserveSpend(ledgerPath, ledger, {
    provider: labeler.name.split(':', 1)[0]!,
    model,
    ...maximumUsage,
    gbp: costGbp(maximumUsage, modelPricing, gbpPerUsd),
    reservationId,
  })
  const labelled = repairFeedback
    ? await labeler.repair(inputs, repairFeedback, onProgress)
    : await labeler.label(inputs, onProgress)
  const actualUsage = labelled.reduce(
    (total, document) => {
      addUsage(total, document.usage)
      return total
    },
    { inputTokens: 0, outputTokens: 0 } satisfies Usage,
  )
  await reconcileSpend(ledgerPath, ledger, reservationId, {
    provider: labeler.name.split(':', 1)[0]!,
    model,
    ...actualUsage,
    gbp: costGbp(actualUsage, modelPricing, gbpPerUsd),
  })
  return {
    documents: new Map(
      labelled.map((document) => [document.customId, document]),
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
