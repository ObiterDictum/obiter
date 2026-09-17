/*
 * Tests for the desktop manifest classifier. Exercised against manifests rather
 * than the real build so each rule (initial vs lazy, shared chunks, workers vs
 * assets, missing files) is pinned on its own.
 */
import { expect, test } from 'vitest'
import { classifyManifest } from './desktop-manifest.mjs'

/** A sizeOf that returns 1000 bytes for every file the manifest references. */
function uniformSizes(manifest) {
  const files = new Set()
  for (const record of Object.values(manifest))
    for (const file of [
      record.file,
      ...(record.css ?? []),
      ...(record.assets ?? []),
    ])
      if (file) files.add(file)
  return (file) => {
    if (!files.has(file)) throw new Error(`unexpected file ${file}`)
    return 1000
  }
}

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

test('classifies the entry closure as initial and dynamic imports as lazy', () => {
  const result = classifyManifest(manifest, uniformSizes(manifest))
  expect(result.initialJs).toEqual({
    bytes: 2000,
    files: ['assets/entry.js', 'assets/shared.js'],
  })
  expect(result.initialCss).toEqual({
    bytes: 1000,
    files: ['assets/entry.css'],
  })
  expect(result.lazyChunks).toEqual({
    bytes: 1000,
    files: ['assets/pdf.js'],
    chunkCount: 1,
  })
  expect(result.largestLazyChunk).toEqual({
    file: 'assets/pdf.js',
    bytes: 1000,
  })
})

test('separates worker scripts from product assets', () => {
  const result = classifyManifest(manifest, uniformSizes(manifest))
  expect(result.workerPayload.files).toEqual(['assets/pdf.worker.mjs'])
  expect(result.productAssets.files).toEqual(['assets/inter.woff2'])
})

test('a chunk in both the static and dynamic closure counts once, as initial', () => {
  const shared = {
    'index.html': {
      file: 'assets/entry.js',
      isEntry: true,
      imports: ['src/shared.ts'],
      dynamicImports: ['src/pdf.ts'],
    },
    'src/shared.ts': { file: 'assets/shared.js' },
    'src/pdf.ts': {
      file: 'assets/pdf.js',
      isDynamicEntry: true,
      imports: ['src/shared.ts'],
    },
  }
  const result = classifyManifest(shared, uniformSizes(shared))
  expect(result.initialJs.files).toEqual([
    'assets/entry.js',
    'assets/shared.js',
  ])
  expect(result.lazyChunks.files).toEqual(['assets/pdf.js'])
  expect(result.lazyChunks.bytes).toBe(1000)
})

test('duplicate dynamic import edges are deduplicated', () => {
  const duplicate = {
    'index.html': {
      file: 'assets/entry.js',
      isEntry: true,
      dynamicImports: ['src/pdf.ts', 'src/pdf.ts'],
    },
    'src/pdf.ts': { file: 'assets/pdf.js', isDynamicEntry: true },
  }
  const result = classifyManifest(duplicate, uniformSizes(duplicate))
  expect(result.lazyChunks.files).toEqual(['assets/pdf.js'])
  expect(result.lazyChunks.bytes).toBe(1000)
})

test('a manifest file with no path, or a missing emitted file, fails', () => {
  const noFile = { 'index.html': { isEntry: true } }
  expect(() => classifyManifest(noFile, uniformSizes(noFile))).toThrow(
    /has no file/,
  )

  const known = uniformSizes(manifest)
  const sizeOf = (file) => {
    if (file === 'assets/pdf.worker.mjs')
      throw new Error(`no such file ${file}`)
    return known(file)
  }
  expect(() => classifyManifest(manifest, sizeOf)).toThrow(/no such file/)
})

test('a zero-byte emitted file fails rather than measuring as zero', () => {
  const sizeOf = () => 0
  expect(() => classifyManifest(manifest, sizeOf)).toThrow(/missing or empty/)
})

test('malformed manifests are rejected', () => {
  const sizes = () => 1000
  expect(() => classifyManifest(null, sizes)).toThrow(/not an object/)
  expect(() => classifyManifest([], sizes)).toThrow(/not an object/)
  expect(() => classifyManifest({}, sizes)).toThrow(/empty/)
  expect(() =>
    classifyManifest(
      {
        a: { file: 'assets/a.js', isEntry: true },
        b: { file: 'assets/b.js', isEntry: true },
      },
      sizes,
    ),
  ).toThrow(/exactly one entry chunk/)
  expect(() =>
    classifyManifest(
      {
        'index.html': {
          file: 'assets/entry.js',
          isEntry: true,
          imports: ['gone'],
        },
      },
      sizes,
    ),
  ).toThrow(/unknown chunk/)
})
