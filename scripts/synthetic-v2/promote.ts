import { readFile, realpath } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  assertSafeOutputRoot,
  readDatasetManifest,
  writeDatasetAtomically,
  writeText,
} from './artifacts'
import {
  assertExternalPartitionRegistry,
  canonicalHash,
  canonicalJson,
  finalizeTournament,
  type ExternalPartitionRegistry,
} from './governance'
import { expectedMatrixCells } from './matrix'
import { corpusStageSpecs } from './program'
import type { SyntheticDocument } from './types'
import {
  NearDuplicateIndex,
  assertDocumentMatchesSpec,
  contentHash,
} from './validation'
import {
  assertBenchmarkPromotion,
  assertCandidateEvidenceBinding,
  publicPromotionMetadata,
  type PromotionEvidence,
} from './promotion'

export async function promoteBenchmark(options: {
  candidateRoot: string
  privateRoot: string
  releaseRoot: string
  version: string
  evidencePath: string
  partitionRegistryPath?: string
  productRoot: string
}) {
  const approvedPrivateRoot = await assertSafeOutputRoot(
    options.privateRoot,
    options.productRoot,
    'private-corpus',
    'benchmark_candidate',
  )
  const candidateRoot = await realpath(resolve(options.candidateRoot))
  if (relative(approvedPrivateRoot, candidateRoot) !== 'benchmark_candidate')
    throw new Error(
      'Promotion candidate must be the private benchmark_candidate staging directory',
    )
  const [candidate, evidence] = await Promise.all([
    readDatasetManifest(candidateRoot, 'benchmark'),
    readEvidence(resolve(options.evidencePath)),
  ])
  assertBenchmarkCandidate(candidate.documents)
  assertCandidateEvidenceBinding(candidate.manifest.manifestHash, evidence)
  if (!options.partitionRegistryPath)
    throw new Error(
      'Benchmark promotion requires a complete partition registry',
    )
  const registry = await readJson(
    resolve(options.partitionRegistryPath),
    'external partition registry',
  )
  assertExternalPartitionRegistry(registry, 'benchmark')
  if (
    candidate.manifest.metadata.partitionRegistryHash !==
    canonicalHash(registry)
  )
    throw new Error(
      'Benchmark candidate does not bind the validated partition registry',
    )
  assertPromotionPartitionDisjointness(candidate.documents, registry, evidence)
  assertBenchmarkPromotion(candidate.documents, evidence)
  return writeDatasetAtomically(candidate.documents, {
    root: options.releaseRoot,
    productRoot: options.productRoot,
    rootKind: 'benchmark-release',
    stage: 'benchmark',
    version: options.version,
    metadata: publicPromotionMetadata(
      candidate.manifest.manifestHash,
      evidence,
    ),
  })
}

export function assertPromotionPartitionDisjointness(
  documents: SyntheticDocument[],
  registry: ExternalPartitionRegistry,
  evidence: PromotionEvidence,
) {
  assertExternalPartitionRegistry(registry, 'benchmark')
  const registryHash = canonicalHash(registry)
  if (evidence.partitionRegistryHash !== registryHash)
    throw new Error(
      'Benchmark promotion evidence does not bind the validated partition registry',
    )
  const priorDocuments = registry.partitions.flatMap((partition) =>
    partition.manifest.documents.map((document) => document.textHash),
  )
  const index = new NearDuplicateIndex(
    0.82,
    registry.partitions.flatMap(
      (partition) => partition.manifest.nearDuplicateSignatures,
    ),
  )
  for (const document of documents) {
    if (document.contentHash !== contentHash(document.text))
      throw new Error(
        `Benchmark promotion found invalid content hash for ${document.id}`,
      )
    if (priorDocuments.includes(document.contentHash))
      throw new Error(
        `Benchmark promotion found exact prior-partition overlap for ${document.id}`,
      )
    const duplicate = index.check(document)
    if (duplicate)
      throw new Error(
        `Benchmark promotion found near-duplicate prior-partition overlap for ${document.id}`,
      )
  }
}

export function assertBenchmarkCandidate(documents: SyntheticDocument[]) {
  const specs = corpusStageSpecs('benchmark')
  const expected = new Map(specs.map((spec) => [spec.id, spec]))
  if (documents.length !== specs.length)
    throw new Error(
      `Benchmark candidate must contain exactly ${specs.length} documents`,
    )
  for (const document of documents) {
    const spec = expected.get(document.id)
    if (!spec)
      throw new Error(
        `Benchmark candidate has an unexpected document ${document.id}`,
      )
    expected.delete(document.id)
    assertDocumentMatchesSpec(document, spec)
  }
  if (expected.size)
    throw new Error('Benchmark candidate is missing required specifications')
  const coveredCells = new Set(
    documents.flatMap((document) => {
      const spec = new Map(specs.map((item) => [item.id, item])).get(
        document.id,
      )!
      const categories = new Set(document.spans.map((span) => span.category))
      return spec.matrixCells.filter((_, index) =>
        categories.has(spec.requiredCategories[index]!),
      )
    }),
  )
  const missingCells = expectedMatrixCells().filter(
    (cell) => !coveredCells.has(cell),
  )
  if (missingCells.length)
    throw new Error('Benchmark candidate is missing required matrix coverage')
}

export async function finalizeTournamentFromFiles(options: {
  tournamentManifestPath: string
  finalizationPath: string
  outputPath: string
}) {
  const [tournament, finalization] = await Promise.all([
    readJson(resolve(options.tournamentManifestPath), 'tournament manifest'),
    readJson(resolve(options.finalizationPath), 'tournament finalization'),
  ])
  const finalized = finalizeTournament(tournament, finalization)
  const output = resolve(options.outputPath)
  await Promise.all([
    writeText(
      `${output}.tournament.json`,
      `${canonicalJson(finalized.tournament)}\n`,
    ),
    writeText(
      `${output}.selection.json`,
      `${canonicalJson(finalized.selection)}\n`,
    ),
  ])
  return finalized
}

async function main() {
  if (flag('--finalize-tournament') === 'true') {
    await finalizeTournamentFromFiles({
      tournamentManifestPath: required('--tournament-manifest'),
      finalizationPath: required('--finalization'),
      outputPath: required('--output'),
    })
    return
  }
  await promoteBenchmark({
    candidateRoot: required('--candidate-root'),
    privateRoot: required('--private-root'),
    releaseRoot: required('--release-root'),
    version: required('--version'),
    evidencePath: required('--evidence'),
    partitionRegistryPath: required('--partition-registry'),
    productRoot: process.cwd(),
  })
}

async function readEvidence(path: string): Promise<PromotionEvidence> {
  return readJson(path, 'promotion evidence') as Promise<PromotionEvidence>
}

async function readJson(path: string, label: string) {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as unknown
  } catch {
    throw new Error(`${label} must be readable JSON`)
  }
}

function required(name: string) {
  const value = flag(name)
  if (!value) throw new Error(`Promotion requires ${name}`)
  return value
}

function flag(name: string) {
  return process.argv
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1)
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Benchmark promotion failed',
    )
    process.exitCode = 1
  })
