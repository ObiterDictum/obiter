import { describe, expect, it } from 'bun:test'
import { createDocumentObjectKey } from './database'
import {
  DocumentMediaStoreError,
  createDocumentImagePartCache,
  getDocumentImagePart,
  retainedImagePartBytes,
} from './document-media-store'
import {
  MemoryStorage,
  imagePartName,
  packageWithImage,
  packageWithImageBytes,
} from './routes/document-media.test-support'

function versionSource(versionId: string, organisationId = 'org_1') {
  const matterId = 'mtr_1'
  const matterDocumentId = 'doc_1'
  return {
    id: versionId,
    organisationId,
    matterId,
    matterDocumentId,
    objectKey: createDocumentObjectKey({
      organisationId,
      matterId,
      documentId: matterDocumentId,
      versionId,
    }),
  }
}

function imagePartMap(byteLength: number) {
  return new Map([
    [
      imagePartName,
      { bytes: new Uint8Array(byteLength), contentType: 'image/png' },
    ],
  ])
}

function viewPartMap(
  buffer: ArrayBuffer,
  byteOffset: number,
  byteLength: number,
) {
  return new Map([
    [
      imagePartName,
      {
        bytes: new Uint8Array(buffer, byteOffset, byteLength),
        contentType: 'image/png',
      },
    ],
  ])
}

describe('retainedImagePartBytes', () => {
  it('measures the backing buffer, not the view, for a subarray part', () => {
    const buffer = new ArrayBuffer(100)
    const parts = viewPartMap(buffer, 10, 10)

    expect(retainedImagePartBytes(parts)).toBe(100)
  })

  it('counts a backing buffer shared by several parts once', () => {
    const buffer = new ArrayBuffer(100)
    const parts = new Map([
      [
        'word/media/a.png',
        { bytes: new Uint8Array(buffer, 0, 10), contentType: 'image/png' },
      ],
      [
        'word/media/b.png',
        { bytes: new Uint8Array(buffer, 10, 10), contentType: 'image/png' },
      ],
    ])

    expect(retainedImagePartBytes(parts)).toBe(100)
  })

  it('sums distinct backing buffers', () => {
    const parts = new Map([
      [
        'word/media/a.png',
        { bytes: new Uint8Array(30), contentType: 'image/png' },
      ],
      [
        'word/media/b.png',
        { bytes: new Uint8Array(40), contentType: 'image/png' },
      ],
    ])

    expect(retainedImagePartBytes(parts)).toBe(70)
  })
})

describe('document image part cache', () => {
  it('evicts the oldest version once the LRU cap is exceeded', async () => {
    const packageBytes = await packageWithImage()
    const first = versionSource('ver_1')
    const second = versionSource('ver_2')
    const storage = new MemoryStorage()
    storage.binary.set(first.objectKey, packageBytes)
    storage.binary.set(second.objectKey, packageBytes)
    const cache = createDocumentImagePartCache(1)

    await getDocumentImagePart(storage, first, imagePartName, cache)
    await getDocumentImagePart(storage, second, imagePartName, cache)
    await getDocumentImagePart(storage, first, imagePartName, cache)

    expect(storage.binaryReads).toEqual([
      first.objectKey,
      second.objectKey,
      first.objectKey,
    ])
  })

  it('does not retain image bytes beyond the cache byte budget', async () => {
    const cache = createDocumentImagePartCache(16, 100)
    cache.set('ver_1', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()
    cache.set('ver_2', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()

    expect(cache.get('ver_1')).toBeUndefined()
    expect(cache.get('ver_2')).toBeDefined()
  })

  it('retains a result exactly at the budget and evicts once it is exceeded', async () => {
    const cache = createDocumentImagePartCache(16, 100)
    cache.set('exact', Promise.resolve(imagePartMap(100)))
    await Promise.resolve()
    expect(cache.get('exact')).toBeDefined()

    cache.set('extra', Promise.resolve(imagePartMap(1)))
    await Promise.resolve()
    expect(cache.get('exact')).toBeUndefined()
    expect(cache.get('extra')).toBeDefined()
  })

  it('does not retain a single result larger than the whole budget', async () => {
    const cache = createDocumentImagePartCache(16, 100)
    cache.set('oversized', Promise.resolve(imagePartMap(101)))
    await Promise.resolve()

    expect(cache.get('oversized')).toBeUndefined()
  })

  it('evicts in access order, not insertion order', async () => {
    const cache = createDocumentImagePartCache(2)
    cache.set('first', Promise.resolve(imagePartMap(1)))
    cache.set('second', Promise.resolve(imagePartMap(1)))
    await Promise.resolve()

    cache.get('first')
    cache.set('third', Promise.resolve(imagePartMap(1)))
    await Promise.resolve()

    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('first')).toBeDefined()
    expect(cache.get('third')).toBeDefined()
  })

  it('replaces an entry for the same key without double counting it', async () => {
    const cache = createDocumentImagePartCache(16, 100)
    cache.set('version', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()
    cache.set('version', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()

    expect(cache.get('version')).toBeDefined()
  })

  it('keeps accounting non-negative across delete and re-insertion', async () => {
    const cache = createDocumentImagePartCache(16, 100)
    cache.set('deleted', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()

    expect(cache.delete('deleted')).toBe(true)
    expect(cache.delete('deleted')).toBe(false)
    cache.set('second', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()
    cache.set('third', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()

    expect(cache.get('second')).toBeUndefined()
    expect(cache.get('third')).toBeDefined()
  })

  it('does not cache a failed load', async () => {
    const cache = createDocumentImagePartCache()
    const failure = Promise.reject(new Error('unreadable package'))
    cache.set('version', failure)
    await failure.catch(() => undefined)
    await Promise.resolve()

    expect(cache.get('version')).toBeUndefined()
  })

  it('does not account for or resurrect an evicted entry that resolves late', async () => {
    const cache = createDocumentImagePartCache(16, 100)
    let resolveLate: (parts: ReturnType<typeof imagePartMap>) => void = () =>
      undefined
    const late = new Promise<ReturnType<typeof imagePartMap>>((resolve) => {
      resolveLate = resolve
    })
    cache.set('slow', late)
    cache.set('other', Promise.resolve(imagePartMap(100)))
    await Promise.resolve()
    cache.set('third', Promise.resolve(imagePartMap(100)))
    await Promise.resolve()
    expect(cache.get('slow')).toBeUndefined()
    expect(cache.get('third')).toBeDefined()

    resolveLate(imagePartMap(60))
    await late
    await Promise.resolve()

    expect(cache.get('slow')).toBeUndefined()
    expect(cache.get('third')).toBeDefined()
  })

  it('does not let a stale rejection delete a newer entry for the same key', async () => {
    const cache = createDocumentImagePartCache()
    let rejectStale: (error: Error) => void = () => undefined
    const stale = new Promise<ReturnType<typeof imagePartMap>>(
      (_resolve, reject) => {
        rejectStale = reject
      },
    )
    cache.set('version', stale)
    cache.set('version', Promise.resolve(imagePartMap(10)))
    await Promise.resolve()

    rejectStale(new Error('stale load failed'))
    await stale.catch(() => undefined)
    await Promise.resolve()

    expect(cache.get('version')).toBeDefined()
  })

  it('counts the backing buffer a small view retains against the budget', async () => {
    const cache = createDocumentImagePartCache(16, 150)
    const buffer = new ArrayBuffer(100)
    cache.set('view', Promise.resolve(viewPartMap(buffer, 0, 10)))
    await Promise.resolve()
    cache.set('tight', Promise.resolve(imagePartMap(60)))
    await Promise.resolve()

    expect(cache.get('view')).toBeUndefined()
    expect(cache.get('tight')).toBeDefined()
  })
})

describe('getDocumentImagePart caching', () => {
  it('re-reads a version whose retained bytes were evicted', async () => {
    const first = versionSource('ver_1')
    const second = versionSource('ver_2')
    const storage = new MemoryStorage()
    storage.binary.set(first.objectKey, await packageWithImageBytes(1000))
    storage.binary.set(second.objectKey, await packageWithImageBytes(2000))
    const cache = createDocumentImagePartCache(16, 2500)

    await getDocumentImagePart(storage, first, imagePartName, cache)
    await getDocumentImagePart(storage, second, imagePartName, cache)
    await getDocumentImagePart(storage, first, imagePartName, cache)

    expect(storage.binaryReads).toEqual([
      first.objectKey,
      second.objectKey,
      first.objectKey,
    ])
  })

  it('serves an image set larger than the budget without retaining it', async () => {
    const source = versionSource('ver_1')
    const storage = new MemoryStorage(await packageWithImageBytes(2000))
    const cache = createDocumentImagePartCache(16, 1500)

    const first = await getDocumentImagePart(
      storage,
      source,
      imagePartName,
      cache,
    )
    const second = await getDocumentImagePart(
      storage,
      source,
      imagePartName,
      cache,
    )

    expect(first?.bytes.byteLength).toBe(2000)
    expect(second?.bytes.byteLength).toBe(2000)
    expect(storage.binaryReads).toEqual([source.objectKey, source.objectKey])
  })

  it('retains an image set exactly at the budget', async () => {
    const source = versionSource('ver_1')
    const storage = new MemoryStorage(await packageWithImageBytes(1000))
    const cache = createDocumentImagePartCache(16, 1000)

    await getDocumentImagePart(storage, source, imagePartName, cache)
    await getDocumentImagePart(storage, source, imagePartName, cache)

    expect(storage.binaryReads).toEqual([source.objectKey])
  })

  it('coalesces concurrent requests for the same version', async () => {
    const source = versionSource('ver_1')
    const storage = new MemoryStorage(await packageWithImageBytes(100))
    let release: () => void = () => undefined
    storage.binaryGate = new Promise<void>((resolve) => {
      release = resolve
    })
    const cache = createDocumentImagePartCache()

    const first = getDocumentImagePart(storage, source, imagePartName, cache)
    const second = getDocumentImagePart(storage, source, imagePartName, cache)
    release()
    const [firstPart, secondPart] = await Promise.all([first, second])

    expect(firstPart?.bytes.byteLength).toBe(100)
    expect(secondPart?.bytes.byteLength).toBe(100)
    expect(storage.binaryReads).toEqual([source.objectKey])
  })

  it('does not reuse one version result for another', async () => {
    const first = versionSource('ver_1')
    const second = versionSource('ver_2')
    const storage = new MemoryStorage()
    storage.binary.set(first.objectKey, await packageWithImageBytes(100, 1))
    storage.binary.set(second.objectKey, await packageWithImageBytes(100, 2))
    const cache = createDocumentImagePartCache()

    const firstPart = await getDocumentImagePart(
      storage,
      first,
      imagePartName,
      cache,
    )
    const secondPart = await getDocumentImagePart(
      storage,
      second,
      imagePartName,
      cache,
    )

    expect(firstPart?.bytes[0]).toBe(1)
    expect(secondPart?.bytes[0]).toBe(2)
    expect(storage.binaryReads).toEqual([first.objectKey, second.objectKey])
  })

  it('does not reuse one organisation result for another', async () => {
    const first = versionSource('ver_1', 'org_1')
    const second = versionSource('ver_1', 'org_2')
    const storage = new MemoryStorage()
    storage.binary.set(first.objectKey, await packageWithImageBytes(100, 1))
    storage.binary.set(second.objectKey, await packageWithImageBytes(100, 2))
    const cache = createDocumentImagePartCache()

    const firstPart = await getDocumentImagePart(
      storage,
      first,
      imagePartName,
      cache,
    )
    const secondPart = await getDocumentImagePart(
      storage,
      second,
      imagePartName,
      cache,
    )

    expect(firstPart?.bytes[0]).toBe(1)
    expect(secondPart?.bytes[0]).toBe(2)
    expect(storage.binaryReads).toEqual([first.objectKey, second.objectKey])
  })

  it('does not cache a failed load', async () => {
    const source = versionSource('ver_1')
    const storage = new MemoryStorage()
    const cache = createDocumentImagePartCache()

    await expect(
      getDocumentImagePart(storage, source, imagePartName, cache),
    ).rejects.toBeInstanceOf(DocumentMediaStoreError)

    storage.binary.set(source.objectKey, await packageWithImageBytes(100))
    const part = await getDocumentImagePart(
      storage,
      source,
      imagePartName,
      cache,
    )

    expect(part?.bytes.byteLength).toBe(100)
    expect(storage.binaryReads).toEqual([source.objectKey, source.objectKey])
  })

  it('validates the object key before any cache or storage lookup', async () => {
    const storage = new MemoryStorage()
    const source = { ...versionSource('ver_1'), organisationId: 'org_2' }
    const cache = createDocumentImagePartCache()

    await expect(
      getDocumentImagePart(storage, source, imagePartName, cache),
    ).rejects.toBeInstanceOf(DocumentMediaStoreError)
    expect(storage.binaryReads).toEqual([])
  })
})
