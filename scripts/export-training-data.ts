import { readFile, writeFile } from 'node:fs/promises'
import {
  assertNoBenchmarkOverlapText,
  assertSafeExternalInputPath,
  assertSafeExternalOutputPath,
  loadExternalBenchmarkGuard,
} from './bench-guard'

type Category =
  | 'person_name'
  | 'email'
  | 'phone'
  | 'address'
  | 'date'
  | 'government_id'
  | 'account_number'
  | 'passport'
  | 'drivers_license'
  | 'url'
  | 'ip_address'
  | 'secret'
  | 'national_insurance'
  | 'case_reference'
  | 'organisation_name'

const mapping: Record<Category, string | null> = {
  person_name: 'GIVEN_NAME',
  email: 'EMAIL',
  phone: 'PHONE',
  address: 'STREET_NAME',
  date: null,
  government_id: 'GOVERNMENT_ID',
  account_number: 'BANK_ACCOUNT',
  passport: 'PASSPORT',
  drivers_license: 'DRIVERS_LICENSE',
  url: 'URL',
  ip_address: 'IP_ADDRESS',
  secret: 'secret',
  national_insurance: 'national_insurance',
  case_reference: 'case_reference',
  organisation_name: null,
}

export interface InputRun {
  id: string
  organisationId: string
  status: string
  fullyReviewed: boolean
  text: string
  spans: Array<{
    id: string
    start: number
    end: number
    text: string
    category: Category
  }>
  decisions: Record<string, { decision: string }>
}

type ExportOptions = {
  inputPath: string
  outputPath: string
  organisationId: string
  benchmarkManifestPath: string
}

export function mapCategoryToRampart(category: Category) {
  return mapping[category]
}

export function exportReviewedRuns(runs: InputRun[], organisationId: string) {
  assertOrganisationScope(runs, organisationId)
  for (const run of runs)
    if (run.status !== 'finalized' || !run.fullyReviewed)
      throw new Error(
        `Training export requires finalized, fully reviewed run ${run.id}`,
      )
  return runs.map((run) => {
    const spans: Record<string, Array<[number, number]>> = {}
    for (const span of run.spans) {
      const decision = run.decisions[span.id]?.decision
      const label = mapping[span.category]
      if (
        !label ||
        !['accept', 'override_redact', 'pseudonymise'].includes(decision) ||
        run.text.slice(span.start, span.end) !== span.text
      )
        continue
      ;(spans[`${label}: ${span.text}`] ??= []).push([span.start, span.end])
    }
    return {
      text: run.text,
      spans,
      info: { id: run.id, source: 'obiter.reviewed_export' },
    }
  })
}

export async function exportTrainingData(options: ExportOptions) {
  if (!options.organisationId.trim())
    throw new Error('Training export requires an explicit organisation scope')
  const [inputPath, benchmark, outputPath] = await Promise.all([
    assertSafeExternalInputPath(options.inputPath),
    loadExternalBenchmarkGuard(options.benchmarkManifestPath),
    assertSafeExternalOutputPath(options.outputPath),
  ])
  const runs = await readReviewedRuns(inputPath)
  const entries = exportReviewedRuns(runs, options.organisationId)
  const output =
    entries.map((entry) => JSON.stringify(entry)).join('\n') +
    (entries.length ? '\n' : '')
  assertNoBenchmarkOverlapText(output, benchmark, outputPath)
  await writeFile(outputPath, output, { flag: 'wx' })
}

async function readReviewedRuns(inputPath: string) {
  let value: unknown
  try {
    value = JSON.parse(await readFile(inputPath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : 'unknown error'
    throw new Error(`Could not read reviewed runs: ${message}`)
  }
  if (!Array.isArray(value) || !value.every(isInputRun))
    throw new Error(
      'Reviewed runs must be an array with organisation-scoped runs',
    )
  return value
}

function assertOrganisationScope(runs: InputRun[], organisationId: string) {
  if (!organisationId.trim())
    throw new Error('Training export requires an explicit organisation scope')
  if (runs.some((run) => run.organisationId !== organisationId))
    throw new Error(
      'Reviewed runs are not exclusively scoped to the organisation',
    )
}

function isInputRun(value: unknown): value is InputRun {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    typeof value.organisationId === 'string' &&
    value.organisationId.trim().length > 0 &&
    typeof value.status === 'string' &&
    typeof value.fullyReviewed === 'boolean' &&
    typeof value.text === 'string' &&
    Array.isArray(value.spans) &&
    value.spans.every(isSpan) &&
    isDecisions(value.decisions)
  )
}

function isSpan(value: unknown): value is InputRun['spans'][number] {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    Number.isInteger(value.start) &&
    Number.isInteger(value.end) &&
    typeof value.text === 'string' &&
    isCategory(value.category)
  )
}

function isDecisions(value: unknown): value is InputRun['decisions'] {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (decision) => isRecord(decision) && typeof decision.decision === 'string',
    )
  )
}

function isCategory(value: unknown): value is Category {
  switch (value) {
    case 'person_name':
    case 'email':
    case 'phone':
    case 'address':
    case 'date':
    case 'government_id':
    case 'account_number':
    case 'passport':
    case 'drivers_license':
    case 'url':
    case 'ip_address':
    case 'secret':
    case 'national_insurance':
    case 'case_reference':
    case 'organisation_name':
      return true
    default:
      return false
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

async function main() {
  const positional = process.argv
    .slice(2)
    .filter((value) => !value.startsWith('--'))
  const [inputPath, outputPath] = positional
  const organisationId = flag('--organisation-id')
  const benchmarkManifestPath = flag('--benchmark-manifest')
  if (!inputPath || !outputPath || !organisationId || !benchmarkManifestPath)
    throw new Error(
      'Usage: tsx scripts/export-training-data.ts <reviewed-runs.json> <external-output.jsonl> --organisation-id=<organisation-id> --benchmark-manifest=/external/benchmark/MANIFEST.json',
    )
  if (process.argv.includes('--include-partial'))
    throw new Error('--include-partial is not permitted for training export')
  await exportTrainingData({
    inputPath,
    outputPath,
    organisationId,
    benchmarkManifestPath,
  })
}

function flag(name: string) {
  return process.argv
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

if (process.argv[1]?.endsWith('export-training-data.ts'))
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Training export failed',
    )
    process.exitCode = 1
  })
