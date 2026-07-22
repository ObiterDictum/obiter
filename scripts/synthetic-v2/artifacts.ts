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
import { canonicalHash, canonicalJson } from './governance'
import type { CorpusStage } from './program'
import { contentHash, nearDuplicateSignature } from './validation'
import type { SyntheticDocument } from './types'

export const rootSentinelFile = 'SYNTHETIC_V2_ROOT.json'
type RootKind = 'private-corpus' | 'benchmark-release'
type DatasetStage = CorpusStage | 'benchmark_candidate'

type ManifestDocument = {
  id: string
  textHash: string
  recordHash: string
}

export type ReleaseManifest = {
  version: 'synthetic-v2-release:v2'
  stage: CorpusStage
  metadata: Record<string, unknown>
  documents: ManifestDocument[]
  nearDuplicateSignatures: ReturnType<typeof nearDuplicateSignature>[]
  manifestHash: string
}

export type DatasetWriteOptions = {
  root: string
  productRoot: string
  stage: DatasetStage
  rootKind: RootKind
  metadata: Record<string, unknown>
  version?: string
  beforeCommit?: (stagingDirectory: string) => Promise<void>
}

export async function assertSafeOutputRoot(
  root: string,
  productRoot: string,
  kind: RootKind,
  stage: DatasetStage,
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

export async function readDatasetManifest(
  directory: string,
  expectedStage?: CorpusStage,
) {
  const root = resolve(directory)
  const [persistedDocuments, manifest] = await Promise.all([
    readDocuments(join(root, 'documents.jsonl')),
    readJson(join(root, 'MANIFEST.json'), 'dataset manifest'),
  ])
  const documents = persistedDocuments.map(({ document }) => document)
  assertReleaseManifestBinding(
    manifest,
    documents,
    expectedStage,
    persistedDocuments.map(({ json }) => json),
  )
  return { manifest, documents }
}

export function assertReleaseManifestBinding(
  value: unknown,
  documents: SyntheticDocument[],
  expectedStage?: CorpusStage,
  persistedJson?: string[],
): asserts value is ReleaseManifest {
  if (!value || typeof value !== 'object')
    throw new Error('Dataset manifest must be an object')
  const manifest = value as Partial<ReleaseManifest>
  if (
    manifest.version !== 'synthetic-v2-release:v2' ||
    !isCorpusStage(manifest.stage) ||
    !isRecord(manifest.metadata) ||
    !Array.isArray(manifest.documents) ||
    !Array.isArray(manifest.nearDuplicateSignatures) ||
    !isHash(manifest.manifestHash)
  )
    throw new Error('Dataset manifest has invalid versioned fields')
  if (expectedStage && manifest.stage !== expectedStage)
    throw new Error(
      `Dataset manifest stage mismatch: expected ${expectedStage}`,
    )
  assertPersistedDocuments(documents)
  const expected = releaseManifest(documents, manifest.metadata)
  if (canonicalJson(expected) !== canonicalJson(manifest))
    throw new Error('Dataset manifest does not bind the persisted documents')
  if (persistedJson) {
    const records = new Map(
      manifest.documents.map((record) => [record.id, record]),
    )
    for (const [index, document] of documents.entries()) {
      const json = persistedJson[index]
      const record = records.get(document.id)
      if (
        !json ||
        !record ||
        createHash('sha256').update(json).digest('hex') !== record.recordHash
      )
        throw new Error('Dataset manifest does not bind the persisted JSON')
    }
  }
}

export function releaseManifest(
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
): ReleaseManifest {
  assertPersistedDocuments(documents)
  const stage = metadata.stage
  if (!isCorpusStage(stage))
    throw new Error('Dataset metadata must name a corpus stage')
  const records = documents
    .map((document) => persistedDocumentRecord(document))
    .sort((left, right) => left.id.localeCompare(right.id))
  const nearDuplicateSignatures = documents
    .map(nearDuplicateSignature)
    .sort((left, right) => left.id.localeCompare(right.id))
  const unsigned = {
    version: 'synthetic-v2-release:v2' as const,
    stage,
    metadata,
    documents: records,
    nearDuplicateSignatures,
  }
  return { ...unsigned, manifestHash: canonicalHash(unsigned) }
}

export function persistedDocumentJson(document: SyntheticDocument) {
  return canonicalJson(document)
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

async function writeDatasetFiles(
  directory: string,
  documents: SyntheticDocument[],
  metadata: Record<string, unknown>,
) {
  const manifest = releaseManifest(documents, metadata)
  await Promise.all([
    writeFile(
      join(directory, 'documents.jsonl'),
      `${documents.map(persistedDocumentJson).join('\n')}\n`,
    ),
    writeFile(join(directory, 'MANIFEST.json'), `${canonicalJson(manifest)}\n`),
    writeFile(
      join(directory, 'stats.json'),
      `${canonicalJson({ ...datasetStats(documents), ...metadata })}\n`,
    ),
  ])
  for (const file of ['documents.jsonl', 'MANIFEST.json', 'stats.json'])
    await access(join(directory, file))
}

function persistedDocumentRecord(
  document: SyntheticDocument,
): ManifestDocument {
  return {
    id: document.id,
    textHash: contentHash(document.text),
    recordHash: createHash('sha256')
      .update(persistedDocumentJson(document))
      .digest('hex'),
  }
}

function assertPersistedDocuments(documents: SyntheticDocument[]) {
  const ids = new Set<string>()
  for (const document of documents) {
    if (!document.id || ids.has(document.id))
      throw new Error('Dataset documents must have unique IDs')
    if (document.contentHash !== contentHash(document.text))
      throw new Error(
        `Dataset document content hash is invalid for ${document.id}`,
      )
    ids.add(document.id)
  }
}

async function readDocuments(path: string) {
  let content: string
  try {
    content = await readFile(path, 'utf8')
  } catch {
    throw new Error('Dataset documents must be readable JSONL')
  }
  const lines = content.split('\n').filter(Boolean)
  if (!lines.length) throw new Error('Dataset documents must not be empty')
  return lines.map((json, index) => {
    try {
      return { document: JSON.parse(json) as SyntheticDocument, json }
    } catch {
      throw new Error(`Dataset document JSON is invalid at line ${index + 1}`)
    }
  })
}

async function readJson(path: string, label: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    throw new Error(`Synthetic ${label} must be readable JSON`)
  }
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

function isCorpusStage(value: unknown): value is CorpusStage {
  return (
    typeof value === 'string' &&
    [
      'tournament',
      'training_seed',
      'development_challenge',
      'benchmark',
    ].includes(value)
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value))
}

function isHash(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)
}
