import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { assertNoBenchmarkOverlap } from '../bench-guard'
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
    await writeFile(
      manifest,
      `${JSON.stringify({ stage: 'benchmark', documents: [{ id: 'bench-1', textHash: contentHash(text) }] })}\n`,
    )
    await writeFile(train, `${JSON.stringify({ id: 'train-1', text })}\n`)

    await expect(assertNoBenchmarkOverlap(train, manifest)).rejects.toThrow(
      'Benchmark contamination detected',
    )
  })
})
