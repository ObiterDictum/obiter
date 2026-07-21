import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  readDatasetManifest,
  rootSentinelFile,
  writeDatasetAtomically,
} from './artifacts'
import { contentHash } from './validation'
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
  contentHash: contentHash('Synthetic.'),
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
      metadata: { stage: 'training_seed' },
    })
    const { manifest } = await readDatasetManifest(destination, 'training_seed')
    expect(manifest.documents[0]?.textHash).toBe(document.contentHash)
    await expect(
      writeDatasetAtomically([document], {
        root: output,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: { stage: 'training_seed' },
      }),
    ).rejects.toThrow('overwrite')
  })

  it('hashes the exact canonical JSON record persisted in documents.jsonl', async () => {
    const output = await root('private-corpus')
    const product = await mkdtemp(join(tmpdir(), 'product-'))
    directories.push(product)
    const destination = await writeDatasetAtomically([document], {
      root: output,
      productRoot: product,
      rootKind: 'private-corpus',
      stage: 'training_seed',
      metadata: { stage: 'training_seed' },
    })
    const [line, { manifest }] = await Promise.all([
      readFile(join(destination, 'documents.jsonl'), 'utf8').then((content) =>
        content.trim(),
      ),
      readDatasetManifest(destination, 'training_seed'),
    ])
    expect(manifest.documents[0]?.recordHash).toBe(
      createHash('sha256').update(line).digest('hex'),
    )
    await writeFile(join(destination, 'documents.jsonl'), `${line} `)
    await expect(
      readDatasetManifest(destination, 'training_seed'),
    ).rejects.toThrow('does not bind')
  })

  it('rejects stale manifests and document content hashes before publication', async () => {
    const output = await root('private-corpus')
    const product = await mkdtemp(join(tmpdir(), 'product-'))
    directories.push(product)
    await expect(
      writeDatasetAtomically([{ ...document, contentHash: 'a'.repeat(64) }], {
        root: output,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: { stage: 'training_seed' },
      }),
    ).rejects.toThrow('content hash is invalid')
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
        metadata: { stage: 'training_seed' },
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
        metadata: { stage: 'training_seed' },
      }),
    ).rejects.toThrow('kind')
    await expect(
      writeDatasetAtomically([document], {
        root: product,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: { stage: 'training_seed' },
      }),
    ).rejects.toThrow('outside')
    const valid = await root('private-corpus')
    await expect(
      writeDatasetAtomically([document], {
        root: valid,
        productRoot: product,
        rootKind: 'private-corpus',
        stage: 'training_seed',
        metadata: { stage: 'training_seed' },
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
