export function classifyManifest(manifest, sizeOf) {
  const records = manifestRecords(manifest)
  const entry = entryChunk(records)

  const initial = reachable(records, [entry], ['imports'])
  const lazyRoots = []
  for (const key of initial)
    for (const dep of records.get(key).dynamicImports ?? []) lazyRoots.push(dep)
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
