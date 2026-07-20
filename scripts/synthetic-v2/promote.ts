import { readFile } from 'node:fs/promises'
import { join, relative, resolve } from 'node:path'
import { assertSafeOutputRoot, writeDatasetAtomically } from './artifacts'
import { assertBenchmarkPromotion, type PromotionEvidence } from './promotion'
import type { SyntheticDocument } from './types'

async function main() {
  const candidateRoot = required('--candidate-root')
  const privateRoot = required('--private-root')
  const releaseRoot = required('--release-root')
  const version = required('--version')
  const evidencePath = required('--evidence')
  const approvedPrivateRoot = await assertSafeOutputRoot(
    privateRoot,
    process.cwd(),
    'private-corpus',
    'benchmark_candidate',
  )
  if (
    relative(approvedPrivateRoot, resolve(candidateRoot)) !==
    'benchmark_candidate'
  )
    throw new Error(
      'Promotion candidate must be the private benchmark_candidate staging directory',
    )
  const documents = await readDocuments(
    join(resolve(candidateRoot), 'documents.jsonl'),
  )
  const evidence = await readEvidence(resolve(evidencePath))
  assertBenchmarkPromotion(documents, evidence)
  await writeDatasetAtomically(documents, {
    root: releaseRoot,
    productRoot: process.cwd(),
    rootKind: 'benchmark-release',
    stage: 'benchmark',
    version,
    metadata: {
      stage: 'benchmark',
      version: 'synthetic-v2-benchmark-promotion:v1',
      candidateRoot: resolve(candidateRoot),
      evidence,
    },
  })
}

async function readEvidence(path: string): Promise<PromotionEvidence> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as PromotionEvidence
  } catch {
    throw new Error('Promotion evidence must be readable JSON')
  }
}

async function readDocuments(path: string) {
  const content = await readFile(path, 'utf8')
  const documents = content
    .split('\n')
    .filter(Boolean)
    .map((line, index) => {
      try {
        return JSON.parse(line) as SyntheticDocument
      } catch {
        throw new Error(`Invalid candidate document JSON at line ${index + 1}`)
      }
    })
  if (!documents.length) throw new Error('Benchmark candidate has no documents')
  return documents
}
function required(name: string) {
  const value = process.argv
    .find((argument) => argument.startsWith(`${name}=`))
    ?.slice(name.length + 1)
  if (!value) throw new Error(`Promotion requires ${name}`)
  return value
}
void main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : 'Benchmark promotion failed',
  )
  process.exitCode = 1
})
