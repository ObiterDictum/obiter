import { describe, expect, it, vi } from 'vitest'
import {
  DocumentPdfViewStoreError,
  getDocumentPdfView,
} from './document-pdf-view-store'
import type { StorageService } from './storage'
import {
  extractedText,
  layout,
  layoutObjectKey,
  MemoryStorage,
  sourceObjectKey,
  textObjectKey,
} from './routes/document-pdf-view.test-support'

const source = {
  id: 'ver_1',
  organisationId: 'org_1',
  matterId: 'mtr_1',
  matterDocumentId: 'doc_1',
  objectKey: sourceObjectKey,
  textObjectKey,
}

describe('PDF view storage boundary', () => {
  it('reads only the canonical stored text and layout concurrently', async () => {
    const reads: string[] = []
    let releaseReads: () => void = () => undefined
    const readGate = new Promise<void>((resolve) => {
      releaseReads = resolve
    })
    const storage: StorageService = {
      async readText(key) {
        reads.push(key)
        await readGate
        if (key === textObjectKey) return extractedText
        if (key === layoutObjectKey) return JSON.stringify(layout)
        throw new Error('unexpected object read')
      },
      async writeText() {
        throw new Error('unexpected object write')
      },
      async delete() {
        throw new Error('unexpected object delete')
      },
    }

    const pending = getDocumentPdfView(storage, source)
    await vi.waitFor(() => expect(reads).toHaveLength(2))
    releaseReads()

    await expect(pending).resolves.toEqual({ text: extractedText, layout })
    expect(reads).toEqual([textObjectKey, layoutObjectKey])
    expect(reads.every((key) => !key.endsWith('/source'))).toBe(true)
    expect(reads.every((key) => !key.includes('quarantine'))).toBe(true)
  })

  it.each([
    ['malformed JSON', '{private malformed layout diagnostic'],
    [
      'an invalid layout shape',
      JSON.stringify({ version: 1, pages: [], segments: [] }),
    ],
  ])('fails safely for stored layout containing %s', async (_name, value) => {
    const storage = new MemoryStorage()
    storage.text.set(layoutObjectKey, value)

    await expectStoreFailure(getDocumentPdfView(storage, source))
    expect(storage.textReads).toEqual([textObjectKey, layoutObjectKey])
  })

  it('fails safely when the stored layout is missing', async () => {
    const storage = new MemoryStorage()
    storage.text.delete(layoutObjectKey)

    await expectStoreFailure(getDocumentPdfView(storage, source))
    expect(storage.textReads).toEqual([textObjectKey, layoutObjectKey])
  })

  it('fails safely when stored text cannot be read', async () => {
    const storage = new MemoryStorage()
    storage.readTextError = new Error('private storage diagnostic')

    await expectStoreFailure(getDocumentPdfView(storage, source))
  })

  it.each([
    [
      'a quarantine source key',
      {
        ...source,
        objectKey: 'org/org_1/quarantine/private/source',
      },
    ],
    [
      'a quarantine text key',
      {
        ...source,
        textObjectKey: 'org/org_1/quarantine/private/text',
      },
    ],
    [
      'a missing text object pointer',
      {
        ...source,
        textObjectKey: null,
      },
    ],
    [
      'a source key with path-like identifiers',
      {
        ...source,
        matterDocumentId: 'doc_1/../../quarantine',
      },
    ],
  ])('refuses %s before any storage read', async (_name, unsafeSource) => {
    const storage = new MemoryStorage()

    await expectStoreFailure(getDocumentPdfView(storage, unsafeSource))
    expect(storage.textReads).toEqual([])
  })
})

async function expectStoreFailure(
  promise: ReturnType<typeof getDocumentPdfView>,
) {
  await expect(promise).rejects.toMatchObject({
    name: 'DocumentPdfViewStoreError',
    message: 'The PDF view could not be read.',
  })
  await promise.catch((error: unknown) => {
    expect(error).toBeInstanceOf(DocumentPdfViewStoreError)
    expect(String(error)).not.toMatch(/private|quarantine|JSON|ENOENT/u)
  })
}
