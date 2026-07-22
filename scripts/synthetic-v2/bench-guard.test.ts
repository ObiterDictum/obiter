import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBenchmarkOverlap } from '../bench-guard'
import { canonicalHash } from './governance'
import { corpusStageSpecs } from './program'
import { contentHash } from './validation'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('bench guard', () => {
  it('fails a deliberate overlap by content hash', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'obiter-bench-guard-'))
    directories.push(directory)
    const text = 'Fictional confidential witness statement.'
    const manifest = join(directory, 'MANIFEST.json')
    const train = join(directory, 'train.jsonl')
    const textHash = contentHash(text)
    await writeFile(
      join(directory, 'SYNTHETIC_V2_ROOT.json'),
      `${JSON.stringify({ kind: 'benchmark-release' })}\n`,
    )
    const documents = corpusStageSpecs('benchmark').map((spec, index) => ({
      id: spec.id,
      textHash: index === 0 ? textHash : String(index).padStart(64, 'a'),
      recordHash: String(index).padStart(64, 'b'),
    }))
    const nearDuplicateSignatures = documents.map((document, index) =>
      index === 0
        ? {
            id: document.id,
            textHash,
            shingles: ['fictional confidential witness statement'],
          }
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
      `${JSON.stringify({ ...unsigned, manifestHash: canonicalHash(unsigned) })}\n`,
    )
    await writeFile(train, `${JSON.stringify({ id: 'train-1', text })}\n`)

    await expect(assertNoBenchmarkOverlap(train, manifest)).rejects.toThrow(
      'Benchmark contamination detected',
    )
  })
})
