import { describe, expect, it } from 'vitest'
import {
  contentDispositionType,
  expectDocument404,
  jpegBytes,
  jpegPartName,
  MemoryStorage,
  mediaUrl,
  packageWithImage,
  packageWithJpeg,
  packageWithScriptedSvg,
  pngBytes,
  routeApp,
  scriptedSvgBytes,
  sourceObjectKey,
  svgPartName,
  TestDatabase,
} from './document-media.test-support'

describe('GET /api/documents/:id/media gates', () => {
  it('returns unauthenticated before database or storage access', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage, null).app.request(
      mediaUrl,
    )

    expect(response.status).toBe(401)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(database.queries).toEqual([])
    expect(storage.binaryReads).toEqual([])
  })

  it.each([
    ['unknown', 'doc_unknown'],
    ['cross-organisation', 'doc_cross'],
    ['soft-deleted', 'doc_deleted'],
  ])(
    'returns the uniform 404 for a %s document without storage access',
    async (_name, id) => {
      const database = new TestDatabase()
      const storage = new MemoryStorage()
      const response = await routeApp(database, storage).app.request(
        `/api/documents/${id}/media?part=word/media/image1.png`,
      )

      await expectDocument404(response)
      expect(storage.binaryReads).toEqual([])
    },
  )

  it('maps denied matter access to the document 404', async () => {
    const database = new TestDatabase({ access: null })
    const storage = new MemoryStorage()
    const response = await routeApp(database, storage).app.request(mediaUrl)

    await expectDocument404(response)
    expect(storage.binaryReads).toEqual([])
  })
})

describe('GET /api/documents/:id/media response', () => {
  it('serves the image bytes from the current ready package', async () => {
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(await packageWithImage())
    const response = await routeApp(database, storage).app.request(mediaUrl)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/png')
    expect(
      contentDispositionType(response.headers.get('content-disposition')),
    ).toBe('attachment')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toMatch(/\bsandbox\b/)
    expect(csp).toMatch(/script-src\s+'none'/)
    expect(response.headers.get('cache-control')).toBe('no-store')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(pngBytes)
    expect(storage.binaryReads).toEqual([sourceObjectKey])
  })

  it('serves scripted SVG with attachment and CSP while keeping script bytes intact', async () => {
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(await packageWithScriptedSvg())
    const response = await routeApp(database, storage).app.request(
      `/api/documents/doc_1/media?part=${encodeURIComponent(svgPartName)}`,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/svg+xml')
    expect(
      contentDispositionType(response.headers.get('content-disposition')),
    ).toBe('attachment')
    const csp = response.headers.get('content-security-policy') ?? ''
    expect(csp).toMatch(/\bsandbox\b/)
    expect(csp).toMatch(/script-src\s+'none'/)
    const body = Buffer.from(await response.arrayBuffer())
    expect(body).toEqual(scriptedSvgBytes)
    expect(body.toString('utf8')).toContain('<script>alert(1)</script>')
  })

  it('serves JPEG image parts with original bytes and image/jpeg', async () => {
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(await packageWithJpeg())
    const response = await routeApp(database, storage).app.request(
      `/api/documents/doc_1/media?part=${encodeURIComponent(jpegPartName)}`,
    )

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(Buffer.from(await response.arrayBuffer())).toEqual(jpegBytes)
  })

  it('unzips the immutable package once for later image requests', async () => {
    const database = new TestDatabase({ access: 'view' })
    const storage = new MemoryStorage(await packageWithImage())
    const { app } = routeApp(database, storage)

    const first = await app.request(mediaUrl)
    const second = await app.request(
      '/api/documents/doc_1/media?part=word/media/image2.png',
    )
    const again = await app.request(mediaUrl)

    expect(first.status).toBe(200)
    expect(second.status).toBe(200)
    expect(again.status).toBe(200)
    expect(storage.binaryReads).toEqual([sourceObjectKey])
  })

  it('returns the uniform 404 for xml parts and missing images', async () => {
    const database = new TestDatabase()
    const storage = new MemoryStorage(await packageWithImage())
    const xml = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/media?part=word/document.xml',
    )
    const missing = await routeApp(database, storage).app.request(
      '/api/documents/doc_1/media?part=word/media/missing.png',
    )

    await expectDocument404(xml)
    await expectDocument404(missing)
  })
})
