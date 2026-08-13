import { describe, expect, it } from 'vitest'
import { createDocumentObjectKey } from './database'
import {
  createDocumentImagePartCache,
  getDocumentImagePart,
} from './document-media-store'
import {
  MemoryStorage,
  packageWithImage,
} from './routes/document-media.test-support'

function versionSource(versionId: string) {
  const organisationId = 'org_1'
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

describe('document image part cache', () => {
  it('evicts the oldest version once the LRU cap is exceeded', async () => {
    const packageBytes = await packageWithImage()
    const first = versionSource('ver_1')
    const second = versionSource('ver_2')
    const storage = new MemoryStorage()
    storage.binary.set(first.objectKey, packageBytes)
    storage.binary.set(second.objectKey, packageBytes)
    const cache = createDocumentImagePartCache(1)

    await getDocumentImagePart(storage, first, 'word/media/image1.png', cache)
    await getDocumentImagePart(storage, second, 'word/media/image1.png', cache)
    await getDocumentImagePart(storage, first, 'word/media/image1.png', cache)

    expect(storage.binaryReads).toEqual([
      first.objectKey,
      second.objectKey,
      first.objectKey,
    ])
  })
})
