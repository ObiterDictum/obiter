/*
 * Renderer manifest traversal for the desktop size budget.
 *
 * The desktop renderer's only honest source of truth for what a window loads is
 * the Vite chunk manifest electron-vite emits (`build.manifest` in
 * electron.vite.config.ts). Source imports cannot answer it, in either
 * direction: a view pulled in through a barrel becomes part of the entry chunk
 * with no source line changing, and a chunk emitted but unreachable still ships.
 *
 * Kept filesystem-free so the classification rules are unit-testable. `sizeOf`
 * is injected and must throw for a file that is not on disk, so a manifest that
 * points at nothing cannot classify as a zero-byte pass.
 */

/**
 * Split a renderer manifest into the budgeted buckets:
 *
 *   initialJs/initialCss — the entry chunk, its static-import closure, and the
 *                          CSS those chunks use. Every open window pays them.
 *   lazyChunks           — chunks reached only through dynamic imports (the PDF
 *                          viewer) and their lazy CSS.
 *   largestLazyChunk     — catches a single lazy surface ballooning.
 *   workerPayload        — scripts referenced as assets (the PDF worker),
 *                          parsed only when a worker is constructed.
 *   productAssets        — fonts and other non-script assets. Shipped, but
 *                          fetched by CSS only when a face is used.
 */
export function classifyManifest(manifest, sizeOf) {
  const records = manifestRecords(manifest)
  const entry = entryChunk(records)

  const initial = reachable(records, [entry], ['imports'])
  const lazyRoots = []
  for (const key of initial)
    for (const dep of records.get(key).dynamicImports ?? []) lazyRoots.push(dep)
  // A dynamic entry can be imported only from inside another lazy chunk, so the
  // manifest mark is a root in its own right.
  for (const [key, record] of records)
    if (record.isDynamicEntry === true) lazyRoots.push(key)
  const lazyKeys = [
    ...reachable(records, lazyRoots, ['imports', 'dynamicImports']),
  ].filter((key) => !initial.has(key))

  const size = (file, owner) => {
    if (typeof file !== 'string' || file.length === 0)
      throw new Error(`manifest ${owner} has no file`)
    const bytes = sizeOf(file)
    if (!Number.isInteger(bytes) || bytes <= 0)
      throw new Error(`emitted file ${file} is missing or empty`)
    return bytes
  }

  const initialJs = new Set()
  const initialCss = new Set()
  const lazyChunks = new Set()
  const lazyCss = new Set()
  const workerPayload = new Set()
  const productAssets = new Set()
  const collect = (keys, js, css) => {
    for (const key of keys) {
      const record = records.get(key)
      size(record.file, `chunk ${key}`)
      js.add(record.file)
      for (const file of record.css ?? []) {
        size(file, `chunk ${key} css`)
        css.add(file)
      }
      for (const asset of record.assets ?? []) {
        size(asset, `chunk ${key} asset`)
        if (/\.m?js$/.test(asset)) workerPayload.add(asset)
        else productAssets.add(asset)
      }
    }
  }
  collect(initial, initialJs, initialCss)
  collect(lazyKeys, lazyChunks, lazyCss)
  // Bytes the initial graph already pays for are not paid again as lazy; a
  // chunk reachable both ways is counted once, in initial.
  for (const file of initialCss) lazyCss.delete(file)
  for (const file of initialJs) {
    lazyChunks.delete(file)
    workerPayload.delete(file)
    productAssets.delete(file)
  }

  const total = (files) =>
    [...files].reduce((sum, file) => sum + sizeOf(file), 0)
  const lazyChunkSizes = [...lazyChunks]
    .map((file) => ({ file, bytes: sizeOf(file) }))
    .sort((a, b) => b.bytes - a.bytes)

  return {
    initialJs: { bytes: total(initialJs), files: [...initialJs].sort() },
    initialCss: { bytes: total(initialCss), files: [...initialCss].sort() },
    lazyChunks: {
      bytes: total(lazyChunks) + total(lazyCss),
      files: [...lazyChunks, ...lazyCss].sort(),
      chunkCount: lazyChunks.size,
    },
    largestLazyChunk: lazyChunkSizes[0] ?? { file: '', bytes: 0 },
    workerPayload: {
      bytes: total(workerPayload),
      files: [...workerPayload].sort(),
    },
    productAssets: {
      bytes: total(productAssets),
      files: [...productAssets].sort(),
    },
  }
}

function manifestRecords(manifest) {
  if (
    manifest === null ||
    typeof manifest !== 'object' ||
    Array.isArray(manifest)
  )
    throw new Error('renderer manifest is not an object')
  const records = new Map(Object.entries(manifest))
  if (records.size === 0) throw new Error('renderer manifest is empty')
  return records
}

function entryChunk(records) {
  const entries = [...records].filter(([, record]) => record.isEntry === true)
  if (entries.length !== 1)
    throw new Error(`expected exactly one entry chunk, found ${entries.length}`)
  return entries[0][0]
}

/** Chunk keys reachable from `roots` over the named edges, deduplicated. */
function reachable(records, roots, edges) {
  const seen = new Set()
  const queue = [...roots]
  while (queue.length > 0) {
    const key = queue.pop()
    if (seen.has(key)) continue
    seen.add(key)
    const record = records.get(key)
    if (!record) throw new Error(`manifest references unknown chunk ${key}`)
    for (const edge of edges)
      for (const dep of record[edge] ?? []) queue.push(dep)
  }
  return seen
}
