import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { corpusStageSpecs } from './synthetic-v2/program'
import { canonicalHash } from './synthetic-v2/governance'
import {
  assertBenchmarkManifest,
  assertNoBenchmarkOverlap,
  contentHash,
  externalRootSentinelFile,
  nearDuplicateSignature,
} from './bench-guard'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

async function externalRoot(kind: 'private-corpus' | 'benchmark-release') {
  const directory = await mkdtemp(join(tmpdir(), 'obiter-bench-guard-'))
  directories.push(directory)
  await writeFile(
    join(directory, externalRootSentinelFile),
    JSON.stringify({ kind }),
  )
  return directory
}

async function benchmarkManifest(root: string, id: string, text: string) {
  const manifest = join(root, 'MANIFEST.json')
  const targetId = corpusStageSpecs('benchmark').some((spec) => spec.id === id)
    ? id
    : corpusStageSpecs('benchmark')[0]!.id
  const documents = corpusStageSpecs('benchmark').map((spec, index) => ({
    id: spec.id,
    textHash:
      spec.id === targetId
        ? contentHash(text)
        : String(index).padStart(64, 'a'),
    recordHash: String(index).padStart(64, 'b'),
  }))
  const nearDuplicateSignatures = documents.map((document, index) =>
    document.id === targetId
      ? nearDuplicateSignature(targetId, text)
      : {
          id: document.id,
          textHash: document.textHash,
          shingles: [`frozen benchmark shingle ${index}`],
        },
  )
  const unsigned = {
    version: 'synthetic-v2-release:v2' as const,
    stage: 'benchmark' as const,
    metadata: { stage: 'benchmark' },
    documents,
    nearDuplicateSignatures,
  }
  await writeFile(
    manifest,
    JSON.stringify({ ...unsigned, manifestHash: canonicalHash(unsigned) }),
  )
  return manifest
}

describe('bench guard', () => {
  it('fails a deliberate exact overlap by content hash', async () => {
    const benchmarkRoot = await externalRoot('benchmark-release')
    const trainingRoot = await externalRoot('private-corpus')
    const text = 'Fictional confidential witness statement for this test only.'
    const manifest = await benchmarkManifest(benchmarkRoot, 'bench-1', text)
    const training = join(trainingRoot, 'train.jsonl')
    await writeFile(training, `${JSON.stringify({ id: 'train-1', text })}\n`)

    await expect(assertNoBenchmarkOverlap(training, manifest)).rejects.toThrow(
      'Benchmark contamination detected',
    )
  })

  it('fails a near duplicate before it can be used for training', async () => {
    const benchmarkRoot = await externalRoot('benchmark-release')
    const trainingRoot = await externalRoot('private-corpus')
    const benchmarkText =
      'The fictional claimant signed the confidential settlement agreement at the solicitors office after reviewing all draft terms with independent legal advice yesterday afternoon.'
    const trainingText =
      'The fictional claimant signed the confidential settlement agreement at the solicitors office after reviewing all draft terms with independent legal advice yesterday morning.'
    const manifest = await benchmarkManifest(
      benchmarkRoot,
      'bench-1',
      benchmarkText,
    )
    const training = join(trainingRoot, 'train.jsonl')
    await writeFile(
      training,
      `${JSON.stringify({ id: 'train-1', text: trainingText })}\n`,
    )

    await expect(assertNoBenchmarkOverlap(training, manifest)).rejects.toThrow(
      'Benchmark near-duplicate contamination detected',
    )
  })

  it('rejects tampered, truncated, wrong-version, and noncanonical frozen manifests', async () => {
    const root = await externalRoot('benchmark-release')
    const path = await benchmarkManifest(
      root,
      'benchmark-00001',
      'Fictional benchmark text with enough words for a non-empty signature.',
    )
    const valid = JSON.parse(await readFile(path, 'utf8'))
    expect(() => assertBenchmarkManifest(valid)).not.toThrow()
    expect(() =>
      assertBenchmarkManifest({ ...valid, version: 'synthetic-v2-release:v1' }),
    ).toThrow('unsupported release version')
    expect(() =>
      assertBenchmarkManifest({
        ...valid,
        documents: valid.documents.slice(1),
        nearDuplicateSignatures: valid.nearDuplicateSignatures.slice(1),
        manifestHash: canonicalHash({
          ...valid,
          documents: valid.documents.slice(1),
          nearDuplicateSignatures: valid.nearDuplicateSignatures.slice(1),
          manifestHash: undefined,
        }),
      }),
    ).toThrow('frozen 280-document set')
    expect(() =>
      assertBenchmarkManifest({
        ...valid,
        documents: [
          valid.documents[1],
          valid.documents[0],
          ...valid.documents.slice(2),
        ],
      }),
    ).toThrow('canonical frozen set')
    expect(() =>
      assertBenchmarkManifest({ ...valid, metadata: { stage: 'tampered' } }),
    ).toThrow('stale or tampered')
  })

  it('rejects a manifest that is not protected by an external release sentinel', async () => {
    const unprotected = await mkdtemp(join(tmpdir(), 'obiter-bench-manifest-'))
    directories.push(unprotected)
    const trainingRoot = await externalRoot('private-corpus')
    const text = 'A benchmark document with enough words for a valid signature.'
    const manifest = await benchmarkManifest(unprotected, 'bench-1', text)
    const training = join(trainingRoot, 'train.jsonl')
    await writeFile(
      training,
      `${JSON.stringify({ id: 'train-1', text: 'safe' })}\n`,
    )

    await expect(assertNoBenchmarkOverlap(training, manifest)).rejects.toThrow(
      'SYNTHETIC_V2_ROOT.json',
    )
  })
})
