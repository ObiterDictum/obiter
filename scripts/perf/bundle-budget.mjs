#!/usr/bin/env node
import { execFileSync } from 'node:child_process'
import { readFile, readdir, stat } from 'node:fs/promises'
import { gzipSync } from 'node:zlib'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { readBuildProvenance } from '../../apps/web/build-provenance.mjs'

export const BUDGETS = {
  initialGzipBytes: 236 * 1024,
  lazyGzipBytes: 425 * 1024,
  largestLazyChunkGzipBytes: 200 * 1024,
  pdfWorkerGzipBytes: 320 * 1024,
}

const PDF_WORKER_PREFIX = 'pdf.worker'

const FORBIDDEN_INITIAL_MARKERS = [
  ['Checking legal sources', 'LegalSearchView'],
  ['Search within case', 'CaseLawDocumentView'],
]

function arg(name, fallback) {
  const i = process.argv.indexOf(`--${name}`)
  return i === -1 ? fallback : process.argv[i + 1]
}

const dist = arg('dist', 'apps/web/dist')
const repoRoot = fileURLToPath(new URL('../../', import.meta.url))

async function requireCheckoutArtifact() {
  const marker = await readBuildProvenance(dist)
  const rebuild = 'run `bun run --filter @obiter/web build` and retry'
  if (!marker?.commit)
    throw new Error(
      `${dist} carries no build provenance commit — it may be stale; ${rebuild}`,
    )
  let head = null
  try {
    head = execFileSync('git', ['-C', repoRoot, 'rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim()
  } catch {}
  if (!head)
    throw new Error(
      `cannot resolve the checkout commit to compare ${dist}'s provenance (${marker.commit}) against`,
    )
  if (marker.commit !== head)
    throw new Error(
      `${dist} was built at ${marker.commit}, but this checkout is ${head} — the artifact is stale; ${rebuild}`,
    )
}

async function rootPreloads(dist_) {
  const serverAssets = join(dist_, 'server', 'assets')
  const files = (await readdir(serverAssets)).filter((name) =>
    name.startsWith('_tanstack-start-manifest'),
  )
  if (files.length !== 1)
    throw new Error(
      `expected exactly one start manifest in ${serverAssets}, found ${files.length}`,
    )
  const source = await readFile(join(serverAssets, files[0]), 'utf8')
  const root = source.match(/__root__:[\s\S]*?preloads: (\[[^\]]*\])/)
  if (!root)
    throw new Error('could not read __root__.preloads from the manifest')
  const paths = [...root[1].matchAll(/"(\/assets\/[^"]+)"/g)].map((m) => m[1])
  if (paths.length === 0) throw new Error('root route preloads are empty')
  return paths.map((path) => path.replace('/assets/', ''))
}

async function gzipSize(file) {
  const bytes = await readFile(file)
  return gzipSync(bytes).length
}

async function main() {
  await requireCheckoutArtifact()
  const clientAssets = join(dist, 'client', 'assets')
  const initialNames = await rootPreloads(dist)
  const initial = new Set(initialNames)

  const initialSources = new Map()
  for (const name of initialNames) {
    initialSources.set(name, await readFile(join(clientAssets, name), 'utf8'))
  }

  let initialGzip = 0
  for (const name of initialNames) {
    initialGzip += await gzipSize(join(clientAssets, name))
  }

  let lazyGzip = 0
  let lazyCount = 0
  let largestLazy = { name: '', bytes: 0 }
  let pdfWorkerGzip = 0
  for (const name of await readdir(clientAssets)) {
    if (!name.endsWith('.js') && !name.endsWith('.mjs')) continue
    if (initial.has(name)) continue
    const size = await stat(join(clientAssets, name))
    if (!size.isFile()) continue
    const gzipped = await gzipSize(join(clientAssets, name))
    if (name.startsWith(PDF_WORKER_PREFIX)) {
      pdfWorkerGzip += gzipped
      continue
    }
    lazyGzip += gzipped
    lazyCount += 1
    if (gzipped > largestLazy.bytes) largestLazy = { name, bytes: gzipped }
  }

  const kb = (n) => `${(n / 1024).toFixed(1)} kB gzip`
  const report = [
    `initial (root preloads, ${initialNames.length} files): ${kb(initialGzip)} / budget ${kb(BUDGETS.initialGzipBytes)}`,
    `lazy route chunks (${lazyCount} chunks): ${kb(lazyGzip)} / budget ${kb(BUDGETS.lazyGzipBytes)}`,
    `largest lazy chunk: ${kb(largestLazy.bytes)} (${largestLazy.name}) / budget ${kb(BUDGETS.largestLazyChunkGzipBytes)}`,
    `pdf worker: ${kb(pdfWorkerGzip)} / budget ${kb(BUDGETS.pdfWorkerGzipBytes)}`,
  ]
  for (const line of report) console.log(line)

  const failures = []
  if (initialGzip > BUDGETS.initialGzipBytes)
    failures.push(
      `initial bundle is ${kb(initialGzip)}, over the ${kb(BUDGETS.initialGzipBytes)} budget`,
    )
  for (const [marker, view] of FORBIDDEN_INITIAL_MARKERS) {
    const hit = [...initialSources].find(([, source]) =>
      source.includes(marker),
    )
    if (hit)
      failures.push(
        `${view} is in the initial graph (${hit[0]}); it must load from its route chunk`,
      )
  }
  if (
    [...initialSources.values()].some((source) =>
      source.includes('jsx-dev-runtime'),
    )
  )
    failures.push('the initial graph contains the React development runtime')
  if (lazyGzip > BUDGETS.lazyGzipBytes)
    failures.push(
      `lazy chunks total ${kb(lazyGzip)}, over the ${kb(BUDGETS.lazyGzipBytes)} budget`,
    )
  if (largestLazy.bytes > BUDGETS.largestLazyChunkGzipBytes)
    failures.push(
      `largest lazy chunk ${largestLazy.name} is ${kb(largestLazy.bytes)}, over the ${kb(BUDGETS.largestLazyChunkGzipBytes)} budget`,
    )
  if (pdfWorkerGzip > BUDGETS.pdfWorkerGzipBytes)
    failures.push(
      `pdf worker is ${kb(pdfWorkerGzip)}, over the ${kb(BUDGETS.pdfWorkerGzipBytes)} budget`,
    )
  if (failures.length > 0) {
    for (const failure of failures)
      console.error(`bundle budget failed: ${failure}`)
    process.exit(1)
  }
  console.log('bundle budget: ok')
}

main().catch((error) => {
  console.error(`bundle budget failed: ${error.message}`)
  process.exit(1)
})
