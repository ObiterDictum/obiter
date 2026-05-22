import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import type { MatterDocument } from '@ormont/contracts'
import {
  createDocumentMetadataMutationOptions,
  createDocumentMetadata,
  deleteDocument,
  deleteDocumentMutationOptions,
  describeMatterDocument,
  getMatterDocumentListState,
  invalidateMatterDocuments,
} from './index'

function document(overrides: Partial<MatterDocument> = {}): MatterDocument {
  return {
    id: 'doc_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    currentVersionId: 'ver_1',
    logicalKey: 'doc_1',
    createdBy: 'usr_1',
    createdAt: '2026-05-22T18:00:00.000Z',
    updatedAt: '2026-05-22T18:00:00.000Z',
    deletedAt: null,
    currentVersion: {
      id: 'ver_1',
      organisationId: 'org_1',
      matterId: 'mtr_1',
      matterDocumentId: 'doc_1',
      filename: 'skeleton-argument.pdf',
      fileType: 'application/pdf',
      sizeBytes: 2048,
      objectKey: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
      textObjectKey: null,
      documentStatus: 'queued',
      failureReason: null,
      versionNumber: 1,
      contentSha256: 'a'.repeat(64),
      syncState: 'synced',
      createdBy: 'usr_1',
      createdAt: '2026-05-22T18:00:00.000Z',
      updatedAt: '2026-05-22T18:00:00.000Z',
    },
    ...overrides,
  }
}

describe('matter document workspace helpers', () => {
  it('identifies the empty state', () => {
    expect(getMatterDocumentListState([])).toBe('empty')
  })

  it('identifies the populated state and exposes current version metadata', () => {
    const details = describeMatterDocument(document())

    expect(getMatterDocumentListState([document()])).toBe('populated')
    expect(details.label).toBe('skeleton-argument.pdf')
    expect(details.versionNumber).toBe('v1')
    expect(details.contentSha256).toBe('a'.repeat(64))
  })
})

describe('matter document mutations', () => {
  it('posts document metadata and invalidates the matter documents query on success', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    const fetchMock = vi.fn<typeof fetch>(async () =>
      new Response(
        JSON.stringify({
          document: document(),
          version: document().currentVersion,
        }),
        { status: 201 },
      ),
    )
    vi.stubGlobal('fetch', fetchMock)

    const result = await createDocumentMetadata('mtr_1', {
      filename: 'skeleton-argument.pdf',
      fileType: 'application/pdf',
      sizeBytes: 2048,
      contentSha256: 'a'.repeat(64),
    })
    createDocumentMetadataMutationOptions(queryClient, 'mtr_1')
    await invalidateMatterDocuments(queryClient, 'mtr_1')

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock.mock.calls[0][0]).toBe('http://localhost:8787/api/matters/mtr_1/documents')
    const [, init] = fetchMock.mock.calls[0]
    const requestInit = init instanceof Request ? undefined : init
    expect(JSON.parse(String(requestInit?.body))).toEqual({
      filename: 'skeleton-argument.pdf',
      fileType: 'application/pdf',
      sizeBytes: 2048,
      contentSha256: 'a'.repeat(64),
    })
    expect(init).toMatchObject({
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    })
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['api', 'matters', 'mtr_1', 'documents'],
    })

    vi.unstubAllGlobals()
  })

  it('surfaces API failures from document metadata creation', async () => {
    const queryClient = new QueryClient()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'validation_failed',
              message: 'Document upload metadata is required.',
              requestId: 'req_1',
            },
          }),
          { status: 400 },
        ),
      ),
    )

    await expect(
      createDocumentMetadata('mtr_1', {
        filename: 'skeleton-argument.pdf',
        fileType: 'application/pdf',
        sizeBytes: 2048,
        contentSha256: 'a'.repeat(64),
      }),
    ).rejects.toThrow('Document upload metadata is required.')

    vi.unstubAllGlobals()
  })

  it('soft-deletes documents and invalidates the matter documents query', async () => {
    const queryClient = new QueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            document: document({ deletedAt: '2026-05-22T18:01:00.000Z' }),
          }),
          { status: 200 },
        ),
      ),
    )

    const result = await deleteDocument('doc_1')
    deleteDocumentMutationOptions(queryClient, 'mtr_1')
    await invalidateMatterDocuments(queryClient, 'mtr_1')

    expect(result.document.deletedAt).toBe('2026-05-22T18:01:00.000Z')
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['api', 'matters', 'mtr_1', 'documents'],
    })

    vi.unstubAllGlobals()
  })

  it('surfaces API failures from document soft-delete', async () => {
    const queryClient = new QueryClient()
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        new Response(
          JSON.stringify({
            error: {
              code: 'document_not_found',
              message: 'Document not found.',
              requestId: 'req_2',
            },
          }),
          { status: 404 },
        ),
      ),
    )

    await expect(deleteDocument('missing')).rejects.toThrow('Document not found.')

    vi.unstubAllGlobals()
  })
})
