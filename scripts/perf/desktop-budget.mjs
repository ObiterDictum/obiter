#!/usr/bin/env node
/*
 * Deterministic desktop size budget over the electron-vite build output.
 *
 * Counts the application payload electron-builder places in the asar, from the
 * renderer's own Vite manifest (`out/renderer/.vite/manifest.json`) rather than
 * from source imports. The manifest traversal lives in ./desktop-manifest.mjs;
 * this module reads the emitted bytes and compares the buckets with ceilings:
 *
 *   renderer initial js/css — the entry chunk, its static-import closure, and
 *                             the CSS those chunks use.
 *   lazy chunks             — chunks reached only through dynamic imports, and
 *                             their lazy CSS.
 *   largest lazy chunk      — catches a single lazy surface ballooning.
 *   worker payload          — scripts referenced as assets (the PDF worker).
 *   product assets          — fonts and other non-script assets.
 *   main / preload          — the Electron entry bundles.
 *   application payload     — every emitted file the packager reads, so a bucket
 *                             this script does not name still cannot grow
 *                             unnoticed.
 *
 * Sizes are raw bytes on disk, not gzip: a packaged renderer is read from the
 * local asar over the custom `obiter://` protocol, never transferred over HTTP,
 * so network compression is not part of the cost being guarded. That differs
 * from scripts/perf/bundle-budget.mjs, which budgets gzip bytes because the
 * browser downloads them. The two must not be compared as if they measured the
 * same thing.
 *
 * Run `bun run --filter @obiter/desktop build` first. A missing build, a missing or
 * malformed manifest, a manifest entry with no file on disk, or a zero-byte
 * file fails the check rather than measuring as a passing zero.
 *
 *   node scripts/perf/desktop-budget.mjs [--out apps/desktop/out]
 *
 * Known limitation: this measures the `out/` on disk, so run it on a fresh
 * build. CI builds immediately before it runs. It does not cover the Electron
 * runtime or the platform installer; see scripts/perf/README.md.
 */
import { readFile, readdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyManifest } from './desktop-manifest.mjs'

/*
 * Baselines measured on a production build at origin/dev 29034f3c on Linux x64
 * (`bun run --filter @obiter/desktop build`). Ceilings carry roughly 10% headroom,
 * the same ratchet margin the web budget uses, so an ordinary addition passes
 * while a return to a larger shape fails. main and preload are contract-sized
 * entry bundles where a percentage is meaningless and are given absolute limits.
 */
export const BUDGETS = {
  // 3,026,290 B. Every route view is statically imported into the one entry
  // chunk, so an added screen lands here.
  rendererInitialJsBytes: 3_330_000,
  // 83,069 B.
  rendererInitialCssBytes: 91_000,
  // 774,344 B (the PDF viewer chunk).
  lazyChunksBytes: 850_000,
  largestLazyChunkBytes: 850_000,
  // 1,046,214 B (pdf.worker.min).
  workerPayloadBytes: 1_150_000,
  // 404,572 B shipped (Inter and IBM Plex Mono, woff and woff2 subsets).
  productAssetsBytes: 445_000,
  // 7,703 B. Absolute, not a percentage: under 8 kB, one import dwarfs a
  // percentage, and a bundler mistake that pulls a library in is far larger.
  mainBundleBytes: 12_000,
  // 456 B. Absolute: the preload bridge is a small fixed contract surface, and
  // a deliberate addition of a few methods should pass.
  preloadBundleBytes: 2_000,
  // 5,343,300 B: everything the packager reads from out/.
  applicationPayloadBytes: 5_870_000,
}

const MANIFEST_PARTS = ['renderer', '.vite', 'manifest.json']

/** The renderer manifest for `outDir`, or a failure that names how to build it. */
export async function readManifest(outDir) {
  const path = join(outDir, ...MANIFEST_PARTS)
  let source
  try {
    source = await readFile(path, 'utf8')
  } catch {
    throw new Error(
      `no renderer manifest at ${path}; run bun run --filter @obiter/desktop build first`,
    )
  }
  try {
    return JSON.parse(source)
  } catch (error) {
    throw new Error(
      `renderer manifest at ${path} is not valid JSON: ${error.message}`,
    )
  }
}

async function rendererAssetSizes(outDir) {
  const assetsDir = join(outDir, 'renderer', 'assets')
  const names = await readdir(assetsDir).catch(() => null)
  if (!names)
    throw new Error(
      `no renderer assets at ${assetsDir}; run bun run --filter @obiter/desktop build first`,
    )
  const sizes = new Map()
  for (const name of names) {
    const info = await stat(join(assetsDir, name)).catch(() => null)
    if (info?.isFile()) sizes.set(`assets/${name}`, info.size)
  }
  if (sizes.size === 0)
    throw new Error(`renderer assets are empty at ${assetsDir}`)
  return sizes
}

/**
 * The renderer is a static asset set; the development React runtime in any
 * emitted chunk would inflate its bytes and never belong in a release build.
 */
async function assertProductionReact(outDir) {
  const assetsDir = join(outDir, 'renderer', 'assets')
  for (const name of await readdir(assetsDir)) {
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue
    const bytes = await readFile(join(assetsDir, name))
    if (bytes.includes('jsx-dev-runtime'))
      throw new Error(
        `renderer chunk ${name} contains the React development runtime; build with NODE_ENV=production`,
      )
  }
}

/** Relative posix paths of every file under `dir`, or null when it is absent. */
async function walkFiles(dir, prefix = '') {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => null)
  if (!entries) return null
  const files = []
  for (const entry of entries) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name
    if (entry.isDirectory()) {
      const nested = await walkFiles(join(dir, entry.name), relative)
      if (nested) files.push(...nested)
    } else if (entry.isFile()) files.push(relative)
  }
  return files.sort()
}

async function directoryBytes(dir, label) {
  const files = await walkFiles(dir)
  if (!files || files.length === 0)
    throw new Error(
      `${label} output is missing or empty at ${dir}; run bun run --filter @obiter/desktop build first`,
    )
  let bytes = 0
  for (const file of files) bytes += (await stat(join(dir, file))).size
  return { bytes, fileCount: files.length }
}

async function payloadBytes(outDir) {
  const files = await walkFiles(outDir)
  if (!files) throw new Error(`no build output at ${outDir}`)
  // The Vite manifest is measurement metadata. electron-builder.yml excludes it
  // from the asar, so it is not part of the payload this budget guards.
  const shipped = files.filter((file) => !file.split('/').includes('.vite'))
  let bytes = 0
  for (const file of shipped) bytes += (await stat(join(outDir, file))).size
  if (bytes <= 0) throw new Error(`build output at ${outDir} is empty`)
  return { bytes, fileCount: shipped.length }
}

/** Measure every budgeted bucket from the build output in `outDir`. */
export async function measureDesktopBuild(outDir) {
  const sizes = await rendererAssetSizes(outDir)
  const manifest = await readManifest(outDir)
  await assertProductionReact(outDir)
  const classified = classifyManifest(manifest, (file) => {
    const bytes = sizes.get(file)
    if (bytes === undefined)
      throw new Error(`manifest references missing emitted file ${file}`)
    return bytes
  })
  return {
    ...classified,
    main: await directoryBytes(join(outDir, 'main'), 'main'),
    preload: await directoryBytes(join(outDir, 'preload'), 'preload'),
    payload: await payloadBytes(outDir),
  }
}

/**
 * Compare measured buckets with the ceilings. A non-positive or unmeasurable
 * bucket is a failure, never a pass: that is the shape a missing build takes.
 */
export function evaluateBudgets(buckets, budgets = BUDGETS) {
  const measured = {
    rendererInitialJsBytes: buckets.initialJs.bytes,
    rendererInitialCssBytes: buckets.initialCss.bytes,
    lazyChunksBytes: buckets.lazyChunks.bytes,
    largestLazyChunkBytes: buckets.largestLazyChunk.bytes,
    workerPayloadBytes: buckets.workerPayload.bytes,
    productAssetsBytes: buckets.productAssets.bytes,
    mainBundleBytes: buckets.main.bytes,
    preloadBundleBytes: buckets.preload.bytes,
    applicationPayloadBytes: buckets.payload.bytes,
  }
  for (const [name, bytes] of Object.entries(measured))
    if (!Number.isInteger(bytes) || bytes <= 0)
      throw new Error(
        `measured ${name} is ${String(bytes)}; refusing a zero-size result`,
      )

  const failures = []
  for (const [name, ceiling] of Object.entries(budgets)) {
    if (!Number.isInteger(ceiling) || ceiling <= 0)
      throw new Error(
        `budget ${name} must be a positive integer, got ${JSON.stringify(ceiling)}`,
      )
    if (!(name in measured))
      throw new Error(`budget ${name} does not match a measured bucket`)
    if (measured[name] > ceiling)
      failures.push(
        `${name} is ${measured[name]} bytes, over the ${ceiling} byte budget`,
      )
  }
  return { measured, failures }
}

function arg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`)
  return index === -1 ? fallback : process.argv[index + 1]
}

async function main() {
  const outDir = arg('out', 'apps/desktop/out')
  const buckets = await measureDesktopBuild(outDir)
  const { failures } = evaluateBudgets(buckets)
  const kb = (bytes) => `${(bytes / 1024).toFixed(1)} kB`
  const rows = [
    [
      'renderer initial js',
      buckets.initialJs.bytes,
      BUDGETS.rendererInitialJsBytes,
    ],
    [
      'renderer initial css',
      buckets.initialCss.bytes,
      BUDGETS.rendererInitialCssBytes,
    ],
    ['lazy chunks', buckets.lazyChunks.bytes, BUDGETS.lazyChunksBytes],
    [
      'largest lazy chunk',
      buckets.largestLazyChunk.bytes,
      BUDGETS.largestLazyChunkBytes,
    ],
    ['worker payload', buckets.workerPayload.bytes, BUDGETS.workerPayloadBytes],
    ['product assets', buckets.productAssets.bytes, BUDGETS.productAssetsBytes],
    ['main bundle', buckets.main.bytes, BUDGETS.mainBundleBytes],
    ['preload bundle', buckets.preload.bytes, BUDGETS.preloadBundleBytes],
    [
      'application payload',
      buckets.payload.bytes,
      BUDGETS.applicationPayloadBytes,
    ],
  ]
  for (const [label, bytes, ceiling] of rows) {
    console.log(
      `${label}: ${bytes} B (${kb(bytes)}) / budget ${ceiling} B (${kb(ceiling)})`,
    )
  }
  console.log(
    `largest lazy chunk: ${buckets.largestLazyChunk.file || 'none'} (${buckets.lazyChunks.chunkCount} lazy chunks)`,
  )
  if (failures.length > 0) {
    for (const failure of failures)
      console.error(`desktop budget failed: ${failure}`)
    process.exit(1)
  }
  console.log('desktop budget: ok')
}

const invoked = process.argv[1]
if (invoked && pathToFileURL(invoked).href === import.meta.url) {
  main().catch((error) => {
    console.error(`desktop budget failed: ${error.message}`)
    process.exit(1)
  })
}
