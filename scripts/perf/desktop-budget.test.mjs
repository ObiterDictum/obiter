/*
 * Tests for desktop build measurement: what is read from disk, what a missing or
 * corrupt artifact does, and how measured bytes are compared with ceilings.
 */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { expect, test } from 'bun:test'
import {
  BUDGETS,
  evaluateBudgets,
  measureDesktopBuild,
  readManifest,
} from './desktop-budget.mjs'

const manifest = {
  'index.html': {
    file: 'assets/entry.js',
    isEntry: true,
    imports: ['src/shared.ts'],
    css: ['assets/entry.css'],
    dynamicImports: ['src/pdf.ts'],
    assets: ['assets/pdf.worker.mjs', 'assets/inter.woff2'],
  },
  'src/shared.ts': { file: 'assets/shared.js' },
  'src/pdf.ts': { file: 'assets/pdf.js', isDynamicEntry: true },
}

const defaultFiles = {
  'renderer/index.html': 'x',
  'renderer/assets/entry.js': 'x'.repeat(1000),
  'renderer/assets/shared.js': 'x'.repeat(1000),
  'renderer/assets/entry.css': 'x'.repeat(1000),
  'renderer/assets/pdf.js': 'x'.repeat(1000),
  'renderer/assets/pdf.worker.mjs': 'x'.repeat(1000),
  'renderer/assets/inter.woff2': 'x'.repeat(1000),
  'main/index.js': 'x'.repeat(1000),
  'preload/index.mjs': 'x'.repeat(1000),
}

async function fixtureOut({
  manifest: manifest_ = manifest,
  files = {},
  drop = [],
} = {}) {
  const root = await mkdtemp(join(tmpdir(), 'obiter-desktop-budget-'))
  const merged = { ...defaultFiles, ...files }
  for (const path of drop) delete merged[path]
  for (const [path, content] of Object.entries(merged)) {
    await mkdir(dirname(join(root, path)), { recursive: true })
    await writeFile(join(root, path), content)
  }
  await mkdir(join(root, 'renderer', '.vite'), { recursive: true })
  if (manifest_ !== null)
    await writeFile(
      join(root, 'renderer', '.vite', 'manifest.json'),
      JSON.stringify(manifest_),
    )
  return root
}

async function withFixtureOut(options, run) {
  const root = await fixtureOut(options)
  try {
    return await run(root)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('readManifest names the missing file and rejects corrupt JSON', async () => {
  const empty = await mkdtemp(join(tmpdir(), 'obiter-desktop-budget-'))
  try {
    await expect(readManifest(empty)).rejects.toThrow(/no renderer manifest/)
    await mkdir(join(empty, 'renderer', '.vite'), { recursive: true })
    await writeFile(
      join(empty, 'renderer', '.vite', 'manifest.json'),
      '{ not json',
    )
    await expect(readManifest(empty)).rejects.toThrow(/not valid JSON/)
  } finally {
    await rm(empty, { recursive: true, force: true })
  }
})

test('measures every bucket and excludes the manifest from the payload', async () => {
  await withFixtureOut({}, async (root) => {
    const buckets = await measureDesktopBuild(root)
    expect(buckets.initialJs.bytes).toBe(2000)
    expect(buckets.lazyChunks.bytes).toBe(1000)
    expect(buckets.main).toEqual({ bytes: 1000, fileCount: 1 })
    expect(buckets.preload).toEqual({ bytes: 1000, fileCount: 1 })
    // Nine shipped files: index.html (1 B), six renderer assets, main and preload.
    expect(buckets.payload).toEqual({ bytes: 8001, fileCount: 9 })
  })
})

test('a missing entry bundle or referenced asset fails measurement', async () => {
  await withFixtureOut({ drop: ['main/index.js'] }, async (root) => {
    await expect(measureDesktopBuild(root)).rejects.toThrow(
      /main output is missing or empty/,
    )
  })
  await withFixtureOut(
    { drop: ['renderer/assets/inter.woff2'] },
    async (root) => {
      await expect(measureDesktopBuild(root)).rejects.toThrow(
        /missing emitted file/,
      )
    },
  )
})

test('a renderer chunk with the development React runtime fails', async () => {
  await withFixtureOut(
    {
      files: {
        'renderer/assets/entry.js': 'x'.repeat(100) + 'jsx-dev-runtime',
      },
    },
    async (root) => {
      await expect(measureDesktopBuild(root)).rejects.toThrow(
        /development runtime/,
      )
    },
  )
})

test('a measured bucket over its ceiling fails and names the bucket', async () => {
  await withFixtureOut({}, async (root) => {
    const buckets = await measureDesktopBuild(root)
    const over = evaluateBudgets(buckets, {
      ...BUDGETS,
      rendererInitialJsBytes: 1,
    })
    expect(over.failures).toEqual([
      'rendererInitialJsBytes is 2000 bytes, over the 1 byte budget',
    ])
  })
})

test('a build within the declared budgets passes', async () => {
  await withFixtureOut({}, async (root) => {
    const buckets = await measureDesktopBuild(root)
    expect(evaluateBudgets(buckets).failures).toEqual([])
  })
})

test('invalid ceilings and unmatched buckets are rejected', async () => {
  await withFixtureOut({}, async (root) => {
    const buckets = await measureDesktopBuild(root)
    for (const ceiling of [0, -1, 1.5, '1000'])
      expect(() =>
        evaluateBudgets(buckets, { ...BUDGETS, mainBundleBytes: ceiling }),
      ).toThrow(/must be a positive integer/)
    expect(() =>
      evaluateBudgets(buckets, { ...BUDGETS, missingBucketBytes: 1 }),
    ).toThrow(/does not match a measured bucket/)
    expect(() =>
      evaluateBudgets({ ...buckets, initialJs: { bytes: 0, files: [] } }),
    ).toThrow(/refusing a zero-size result/)
  })
})
