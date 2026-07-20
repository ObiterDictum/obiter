import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { rootSentinelFile, writeDatasetAtomically } from './artifacts'
import type { SyntheticDocument } from './types'

const directories: string[] = []
afterEach(async () => {
  await Promise.all(
    directories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})
const document: SyntheticDocument = {
  id: 'doc-1',
  text: 'Synthetic.',
  spans: [],
  generator: 'fake:model',
  specCell: 'x',
  matrixCells: [],
  contentHash: 'a'.repeat(64),
}

async function readManifest(
  path: string,
): Promise<{ documents: Array<{ textHash: string }> }> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as {
      documents: Array<{ textHash: string }>
    }
  } catch {
    throw new Error('Test fixture manifest was not readable JSON')
  }
}

async function root(kind: 'private-corpus' | 'benchmark-release') {
  const directory = await mkdtemp(join(tmpdir(), 'synthetic-v2-root-'))
  directories.push(directory)
  await writeFile(join(directory, rootSentinelFile), JSON.stringify({ kind }))
  return directory
}

describe('safe synthetic artifact outputs', () => {
  it('requires an external sentinel and atomically creates a new dataset', async () => {
    const output = await root('private-corpus')
    const product = await mkdtemp(join(tmpdir(), 'product-'))
    directories.push(product)
    const destination = await writeDatasetAtomically([document], {
      root: output,
      productRoot: product,
      rootKind: 'private-corpus',
      stage: 'training_seed',
      metadata: {},
    })
    const manifest = await readManifest(join(destination, 'MANIFEST.json'))
    expect(manifest.documents[0].textHash).toBe(document.contentHash)
    await expect(
      writeDatasetAtomically([document], {
        root: output,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: {},
      }),
    ).rejects.toThrow('overwrite')
  })
  it('fails closed for missing/wrong sentinels, repository containment, and commit failure cleanup', async () => {
    const output = await mkdtemp(join(tmpdir(), 'synthetic-v2-no-sentinel-'))
    directories.push(output)
    const product = await mkdtemp(join(tmpdir(), 'product-'))
    directories.push(product)
    await expect(
      writeDatasetAtomically([document], {
        root: output,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: {},
      }),
    ).rejects.toThrow(/sentinel/i)
    await writeFile(
      join(output, rootSentinelFile),
      JSON.stringify({ kind: 'benchmark-release' }),
    )
    await expect(
      writeDatasetAtomically([document], {
        root: output,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: {},
      }),
    ).rejects.toThrow('kind')
    await expect(
      writeDatasetAtomically([document], {
        root: product,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: {},
      }),
    ).rejects.toThrow('outside')
    const valid = await root('private-corpus')
    await expect(
      writeDatasetAtomically([document], {
        root: valid,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: {},
        beforeCommit: async () => {
          throw new Error('test failure')
        },
      }),
    ).rejects.toThrow('test failure')
    expect(
      (await readdir(valid)).some((entry) => entry.includes('staging')),
    ).toBe(false)
  })
})
