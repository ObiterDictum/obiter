import { createHash } from 'node:crypto'
import { readFile, realpath } from 'node:fs/promises'
import { basename, dirname, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { canonicalHash } from './synthetic-v2/governance'
import { corpusStageSpecs } from './synthetic-v2/program'

const nearDuplicateThreshold = 0.82
export const externalRootSentinelFile = 'SYNTHETIC_V2_ROOT.json'

const benchmarkReleaseVersion = 'synthetic-v2-release:v2'
const frozenBenchmarkIds = corpusStageSpecs('benchmark').map((spec) => spec.id)

type BenchmarkDocument = {
  id: string
  textHash: string
  recordHash: string
}
type NearDuplicateSignature = {
  id: string
  textHash: string
  shingles: string[]
}
export type BenchmarkManifest = {
  version: typeof benchmarkReleaseVersion
  stage: 'benchmark'
  metadata: Record<string, unknown>
  documents: BenchmarkDocument[]
  nearDuplicateSignatures: NearDuplicateSignature[]
  manifestHash: string
}
export type BenchmarkGuard = {
  hashes: Set<string>
  nearDuplicateSignatures: NearDuplicateSignature[]
}

export function contentHash(text: string) {
  return createHash('sha256').update(text).digest('hex')
}

export function nearDuplicateSignature(id: string, text: string) {
  return {
    id,
    textHash: contentHash(text),
    shingles: [...normalizedShingles(text)].sort(),
  }
}

export async function loadExternalBenchmarkGuard(manifestPath: string) {
  const canonicalManifest = await realpath(resolve(manifestPath))
  await findSentinelRoot(
    dirname(canonicalManifest),
    'benchmark-release',
    'Benchmark manifest',
  )
  const manifest = parseJson<unknown>(
    await readFile(canonicalManifest, 'utf8'),
    canonicalManifest,
  )
  assertBenchmarkManifest(manifest)
  return {
    hashes: new Set(manifest.documents.map((document) => document.textHash)),
    nearDuplicateSignatures: manifest.nearDuplicateSignatures,
  }
}

export async function assertNoBenchmarkOverlap(
  trainingPath: string,
  manifestPath: string,
) {
  const [training, benchmark] = await Promise.all([
    readFile(trainingPath, 'utf8'),
    loadExternalBenchmarkGuard(manifestPath),
  ])
  assertNoBenchmarkOverlapText(training, benchmark, trainingPath)
}

export function assertNoBenchmarkOverlapText(
  training: string,
  benchmark: BenchmarkGuard,
  context = 'training export',
) {
  const documents = training
    .split('\n')
    .filter(Boolean)
    .map((line, index) =>
      parseTrainingDocument(line, `${context}:${index + 1}`),
    )
  const exactOverlaps = documents
    .filter((document) => benchmark.hashes.has(contentHash(document.text)))
    .map((document) => document.id)
  if (exactOverlaps.length)
    throw new Error(
      `Benchmark contamination detected in ${context}: ${exactOverlaps.join(', ')}`,
    )

  const nearOverlaps = documents.flatMap((document) => {
    const candidate = normalizedShingles(document.text)
    return benchmark.nearDuplicateSignatures.flatMap((signature) => {
      const similarity = jaccardSimilarity(
        candidate,
        new Set(signature.shingles),
      )
      return similarity >= nearDuplicateThreshold
        ? [`${document.id} ~ ${signature.id} (${similarity.toFixed(4)})`]
        : []
    })
  })
  if (nearOverlaps.length)
    throw new Error(
      `Benchmark near-duplicate contamination detected in ${context}: ${nearOverlaps.join(', ')}`,
    )
}

export async function assertSafeExternalInputPath(inputPath: string) {
  const input = await realpath(resolve(inputPath))
  await findSentinelRoot(dirname(input), 'private-corpus', 'Training input')
  return input
}

export async function assertSafeExternalOutputPath(outputPath: string) {
  const destination = resolve(outputPath)
  const parent = await realpath(dirname(destination))
  await findSentinelRoot(parent, 'private-corpus', 'Training output')
  return resolve(parent, basename(destination))
}

async function main() {
  const input = flag('--input')
  const manifest = flag('--benchmark-manifest')
  if (!input || !manifest)
    throw new Error(
      'Usage: pnpm bench:guard --input=/external/private/documents.jsonl --benchmark-manifest=/external/benchmark/MANIFEST.json',
    )
  await assertNoBenchmarkOverlap(resolve(input), resolve(manifest))
}

function flag(name: string) {
  return process.argv
    .find((value) => value.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

function parseJson<T>(value: string, context: string): T {
  try {
    return JSON.parse(value) as T
  } catch {
    throw new Error(`Invalid JSON in ${context}`)
  }
}

function parseTrainingDocument(value: string, context: string) {
  const document = parseJson<unknown>(value, context)
  if (
    !isRecord(document) ||
    typeof document.text !== 'string' ||
    (document.id !== undefined && typeof document.id !== 'string')
  )
    throw new Error(
      `Training document in ${context} must include text and optional id`,
    )
  return { id: document.id ?? '(unidentified)', text: document.text }
}

export function assertBenchmarkManifest(
  value: unknown,
): asserts value is BenchmarkManifest {
  if (
    !isRecord(value) ||
    value.version !== benchmarkReleaseVersion ||
    value.stage !== 'benchmark' ||
    !isRecord(value.metadata) ||
    !isHash(value.manifestHash)
  )
    throw new Error(
      'Benchmark manifest has unsupported release version or fields',
    )
  if (
    !Array.isArray(value.documents) ||
    !Array.isArray(value.nearDuplicateSignatures) ||
    value.documents.length !== frozenBenchmarkIds.length
  )
    throw new Error(
      'Benchmark manifest does not contain the frozen 280-document set',
    )
  if (
    !value.documents.every(isBenchmarkDocument) ||
    hasDuplicateIds(value.documents)
  )
    throw new Error('Benchmark manifest contains invalid document hashes')
  if (
    value.documents.some(
      (document, index) => document.id !== frozenBenchmarkIds[index],
    )
  )
    throw new Error(
      'Benchmark manifest document IDs are not the canonical frozen set',
    )
  if (
    !value.nearDuplicateSignatures.every(isNearDuplicateSignature) ||
    hasDuplicateIds(value.nearDuplicateSignatures)
  )
    throw new Error(
      'Benchmark manifest contains invalid near-duplicate signatures',
    )
  const documentsById = new Map(
    value.documents.map((document) => [document.id, document]),
  )
  if (
    value.nearDuplicateSignatures.length !== value.documents.length ||
    value.nearDuplicateSignatures.some(
      (signature, index) =>
        signature.id !== frozenBenchmarkIds[index] ||
        documentsById.get(signature.id)?.textHash !== signature.textHash,
    )
  )
    throw new Error(
      'Benchmark manifest near-duplicate signatures must cover the canonical frozen set',
    )
  const { manifestHash, ...unsigned } = value
  if (canonicalHash(unsigned) !== manifestHash)
    throw new Error('Benchmark manifest hash is stale or tampered')
}

function isBenchmarkDocument(value: unknown): value is BenchmarkDocument {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    isHash(value.textHash) &&
    isHash(value.recordHash)
  )
}

function isNearDuplicateSignature(
  value: unknown,
): value is NearDuplicateSignature {
  return (
    isRecord(value) &&
    typeof value.id === 'string' &&
    value.id.trim().length > 0 &&
    isHash(value.textHash) &&
    Array.isArray(value.shingles) &&
    value.shingles.length > 0 &&
    value.shingles.every(
      (shingle) => typeof shingle === 'string' && shingle.trim().length > 0,
    )
  )
}

function isHash(value: unknown) {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}

function hasDuplicateIds(entries: Array<{ id: string }>) {
  return new Set(entries.map((entry) => entry.id)).size !== entries.length
}

function normalizedShingles(text: string, size = 5) {
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []
  return new Set(
    Array.from({ length: Math.max(0, words.length - size + 1) }, (_, index) =>
      words.slice(index, index + size).join(' '),
    ),
  )
}

function jaccardSimilarity(left: Set<string>, right: Set<string>) {
  const intersection = [...left].filter((shingle) => right.has(shingle)).length
  const union = left.size + right.size - intersection
  return union === 0 ? 1 : intersection / union
}

async function findSentinelRoot(
  path: string,
  expectedKind: 'private-corpus' | 'benchmark-release',
  label: string,
) {
  const productRoot = await productRepositoryRoot()
  let current = await realpath(path)
  while (true) {
    if (isInside(current, productRoot))
      throw new Error(`${label} must be outside the Obiter product repository`)
    const sentinel = await readSentinel(current)
    if (sentinel) {
      if (sentinel.kind !== expectedKind)
        throw new Error(
          `${label} sentinel kind does not match its required root`,
        )
      return current
    }
    const parent = dirname(current)
    if (parent === current)
      throw new Error(
        `${label} must be under an external ${externalRootSentinelFile} root`,
      )
    current = parent
  }
}

async function productRepositoryRoot() {
  return realpath(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
}

async function readSentinel(directory: string) {
  try {
    const sentinel = parseJson<unknown>(
      await readFile(resolve(directory, externalRootSentinelFile), 'utf8'),
      `${directory}/${externalRootSentinelFile}`,
    )
    if (!isRecord(sentinel) || typeof sentinel.kind !== 'string')
      throw new Error('Sentinel must declare a root kind')
    return sentinel
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return undefined
    if (
      error instanceof Error &&
      error.message === 'Sentinel must declare a root kind'
    )
      throw error
    throw new Error(
      `Could not read ${externalRootSentinelFile} in external root ${directory}`,
    )
  }
}

function isInside(child: string, parent: string) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !path.includes(':'))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function hasCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

if (process.argv[1]?.endsWith('bench-guard.ts'))
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Benchmark guard failed',
    )
    process.exitCode = 1
  })
