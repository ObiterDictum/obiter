import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { contentHash } from './synthetic-v2/validation'

export type BenchmarkManifest = {
  documents: Array<{ id: string; contentHash: string }>
}

export async function benchmarkHashes(manifestPath: string) {
  const manifest = parseJson<BenchmarkManifest>(
    await readFile(manifestPath, 'utf8'),
    manifestPath,
  )
  return new Set(manifest.documents.map((document) => document.contentHash))
}

export async function assertNoBenchmarkOverlap(
  trainingPath: string,
  manifestPath = 'data/bench/uk-legal-pii/MANIFEST.json',
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
  if (input) {
    await assertNoBenchmarkOverlap(input, flag('--manifest'))
    return
  }
  const defaultTraining = resolve(
    'data/synthetic/uk-legal-train/documents.jsonl',
  )
  try {
    await assertNoBenchmarkOverlap(defaultTraining, flag('--manifest'))
  } catch (error) {
    if (isMissingTrainingFile(error)) return
    throw error
  }
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

function isMissingTrainingFile(error: unknown) {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  )
}

if (process.argv[1]?.endsWith('bench-guard.ts'))
  void main().catch((error: unknown) => {
    console.error(
      error instanceof Error ? error.message : 'Benchmark guard failed',
    )
    process.exitCode = 1
  })
