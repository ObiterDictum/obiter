import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentHash } from './synthetic-v2/validation'

export type BenchmarkManifest = {
  stage: string
  documents: Array<{ id: string; textHash?: string; contentHash?: string }>
  nearDuplicateSignatures?: Array<{ id: string; shingles: string[] }>
}

export async function benchmarkHashes(manifestPath: string) {
  const manifest = parseJson<BenchmarkManifest>(
    await readFile(manifestPath, 'utf8'),
    manifestPath,
  )
  if (
    manifest.stage !== 'benchmark' ||
    !Array.isArray(manifest.documents) ||
    manifest.documents.length === 0
  )
    throw new Error(
      'Benchmark manifest must be a non-empty benchmark partition manifest',
    )
  const hashes = manifest.documents.map(
    (document) => document.textHash ?? document.contentHash,
  )
  if (
    hashes.some(
      (hash) => typeof hash !== 'string' || !/^[a-f0-9]{64}$/.test(hash),
    )
  )
    throw new Error('Benchmark manifest contains invalid text hashes')
  return new Set(hashes as string[])
}

export async function assertNoBenchmarkOverlap(
  trainingPath: string,
  manifestPath: string,
) {
  const [training, hashes] = await Promise.all([
    readFile(trainingPath, 'utf8'),
    benchmarkHashes(manifestPath),
  ])
  assertNoBenchmarkOverlapText(training, hashes, trainingPath)
}

export function assertNoBenchmarkOverlapText(
  training: string,
  hashes: Set<string>,
  context = 'training export',
) {
  const overlaps = training
    .split('\n')
    .filter(Boolean)
    .map((line, index) =>
      parseJson<{ id?: string; text: string }>(line, `${context}:${index + 1}`),
    )
    .filter((document) => hashes.has(contentHash(document.text)))
    .map((document) => document.id ?? '(unidentified)')
  if (overlaps.length)
    throw new Error(
      `Benchmark contamination detected in ${context}: ${overlaps.join(', ')}`,
    )
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
if (process.argv[1]?.endsWith('bench-guard.ts'))
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Benchmark guard failed',
    )
    process.exitCode = 1
  })
