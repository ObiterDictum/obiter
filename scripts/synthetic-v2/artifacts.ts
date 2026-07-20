import { createHash } from 'node:crypto'
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { expectedMatrixCells } from './matrix'
import { canonicalHash } from './governance'
import { nearDuplicateSignature } from './validation'
import type { CorpusStage } from './program'
import type { SyntheticDocument } from './types'

export const rootSentinelFile = 'SYNTHETIC_V2_ROOT.json'
type RootKind = 'private-corpus' | 'benchmark-release'

export type DatasetWriteOptions = {
  root: string
  productRoot: string
  stage: CorpusStage | 'benchmark_candidate'
  rootKind: RootKind
  metadata: Record<string, unknown>
  version?: string
  beforeCommit?: (stagingDirectory: string) => Promise<void>
}

export async function assertSafeOutputRoot(
  root: string,
  productRoot: string,
  kind: RootKind,
  stage: DatasetWriteOptions['stage'],
) {
  const canonicalRoot = await canonicalExistingPath(root, 'output root')
  const canonicalProduct = await canonicalExistingPath(
    productRoot,
    'product repository',
  )
  if (isInside(canonicalRoot, canonicalProduct))
    throw new Error(
      'Synthetic corpus output root must be outside the Obiter product repository',
    )
  const sentinelPath = join(canonicalRoot, rootSentinelFile)
  let sentinel: unknown
  try {
    sentinel = JSON.parse(await readFile(sentinelPath, 'utf8'))
  } catch {
    throw new Error(
      `Synthetic output root is missing readable sentinel ${rootSentinelFile}`,
    )
  }
  if (
    !sentinel ||
    typeof sentinel !== 'object' ||
    (sentinel as { kind?: unknown }).kind !== kind
  )
    throw new Error(
      'Synthetic output root sentinel kind does not match requested output',
    )
  if (kind === 'benchmark-release' && stage !== 'benchmark')
    throw new Error('Benchmark release root only accepts benchmark promotion')
  if (kind === 'private-corpus' && stage === 'benchmark')
    throw new Error(
      'Private corpus root accepts benchmark candidates, not released benchmarks',
    )
  return canonicalRoot
}

export async function writeDatasetAtomically(
  documents: SyntheticDocument[],
  options: DatasetWriteOptions,
) {
  const root = await assertSafeOutputRoot(
    options.root,
    options.productRoot,
    options.rootKind,
    options.stage,
  )
  const leaf = options.version
    ? join(options.stage, options.version)
    : options.stage
  const destination = resolve(root, leaf)
  if (!isInside(destination, root))
    throw new Error('Dataset destination escapes approved output root')
  await mkdir(dirname(destination), { recursive: true })
  await assertAbsent(destination)
  const staging = await mkdtemp(join(root, `.${options.stage}-staging-`))
  try {
    await writeDatasetFiles(staging, documents, options.metadata)
    await options.beforeCommit?.(staging)
    await rename(staging, destination)
    return destination
  } catch (error) {
    await rm(staging, { recursive: true, force: true })
    throw error
  }
}

async function writeDatasetFiles(
  directory: string,
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
) {
  const manifest = releaseManifest(documents, metadata)
  await Promise.all([
    writeFile(
      join(directory, 'documents.jsonl'),
      `${documents.map((document) => JSON.stringify(document)).join('\n')}\n`,
    ),
    writeFile(
      join(directory, 'MANIFEST.json'),
      `${JSON.stringify(manifest, null, 2)}\n`,
    ),
    writeFile(
      join(directory, 'stats.json'),
      `${JSON.stringify({ ...datasetStats(documents), ...metadata }, null, 2)}\n`,
    ),
  ])
  for (const file of ['documents.jsonl', 'MANIFEST.json', 'stats.json'])
    await access(join(directory, file))
}

export function releaseManifest(
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
) {
  const records = documents
    .map((document) => ({
      id: document.id,
      textHash: document.contentHash,
      recordHash: createHash('sha256')
        .update(canonicalJsonRecord(document))
        .digest('hex'),
    }))
    .sort((left, right) => left.id.localeCompare(right.id))
  const nearDuplicateSignatures = documents
    .map(nearDuplicateSignature)
    .sort((left, right) => left.id.localeCompare(right.id))
  const stage = typeof metadata.stage === 'string' ? metadata.stage : 'unknown'
  return {
    version: 'synthetic-v2-release:v2',
    stage,
    metadata,
    documents: records,
    nearDuplicateSignatures,
    manifestHash: canonicalHash({
      stage,
      metadata,
      records,
      nearDuplicateSignatures,
    }),
  }
}

function canonicalJsonRecord(document: SyntheticDocument) {
  return JSON.stringify({
    id: document.id,
    text: document.text,
    spans: [...document.spans].sort((left, right) => left.start - right.start),
    specCell: document.specCell,
    matrixCells: document.matrixCells,
    generator: document.generator,
    hardNegatives: document.hardNegatives,
  })
}

export function datasetStats(documents: SyntheticDocument[]) {
  const categories: Record<string, number> = {}
  const matrix: Record<string, number> = {}
  const lengths = documents
    .map((document) => document.text.length)
    .sort((a, b) => a - b)
  for (const document of documents) {
    for (const span of document.spans)
      categories[span.category] = (categories[span.category] ?? 0) + 1
    for (const cell of document.matrixCells)
      matrix[cell] = (matrix[cell] ?? 0) + 1
  }
  const missingCells = expectedMatrixCells().filter((cell) => !matrix[cell])
  return {
    totalDocuments: documents.length,
    spansByCategory: categories,
    matrix,
    missingMatrixCells: missingCells,
    documentLengthCharacters: {
      min: lengths[0] ?? 0,
      median: lengths[Math.floor(lengths.length / 2)] ?? 0,
      max: lengths.at(-1) ?? 0,
    },
  }
}

export async function writeText(path: string, text: string) {
  await mkdir(dirname(path), { recursive: true })
  await writeFile(path, text, { flag: 'wx' })
}

async function canonicalExistingPath(path: string, label: string) {
  try {
    return await realpath(resolve(path))
  } catch {
    throw new Error(`Synthetic ${label} must already exist`)
  }
}

async function assertAbsent(path: string) {
  try {
    await access(path)
  } catch (error) {
    if (hasCode(error, 'ENOENT')) return
    throw new Error(
      `Could not safely inspect synthetic artifact destination: ${path}`,
    )
  }
  throw new Error(`Refusing to overwrite existing synthetic artifact: ${path}`)
}

function hasCode(error: unknown, code: string) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === code
  )
}

function isInside(child: string, parent: string) {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !path.includes(':'))
}
