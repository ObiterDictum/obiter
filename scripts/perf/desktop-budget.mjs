#!/usr/bin/env node
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { classifyManifest } from './desktop-manifest.mjs'

export const BUDGETS = {
  rendererInitialJsBytes: 3_600_000,
  rendererInitialCssBytes: 93_000,
  lazyChunksBytes: 935_000,
  largestLazyChunkBytes: 850_000,
  workerPayloadBytes: 1_150_000,
  productAssetsBytes: 790_000,
  mainBundleBytes: 12_000,
  preloadBundleBytes: 2_000,
  applicationPayloadBytes: 6_510_000,
}

const MANIFEST_PARTS = ['renderer', '.vite', 'manifest.json']

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
  const shipped = files.filter((file) => !file.split('/').includes('.vite'))
  let bytes = 0
  for (const file of shipped) bytes += (await stat(join(outDir, file))).size
  if (bytes <= 0) throw new Error(`build output at ${outDir} is empty`)
  return { bytes, fileCount: shipped.length }
}

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
  const jsonOut = arg('json')
  if (jsonOut) {
    await mkdir(dirname(jsonOut), { recursive: true })
    await writeFile(
      jsonOut,
      `${JSON.stringify(
        Object.fromEntries(
          Object.entries(buckets).flatMap(([name, bucket]) =>
            typeof bucket?.bytes === 'number' ? [[name, bucket.bytes]] : [],
          ),
        ),
        null,
        2,
      )}\n`,
      'utf8',
    )
  }
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
