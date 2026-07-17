// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from 'react'
import { act, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from './api'
import {
  documentsKeys,
  documentQueryOptions,
  matterDocumentsQueryOptions,
  useDeleteDocument,
} from './documents'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: api.apiFetch }
})

function sampleVersion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'ver_1',
    organisationId: 'org_1',
    matterId: 'mtr_1',
    matterDocumentId: 'doc_1',
    filename: 'brief.pdf',
    fileType: 'application/pdf',
    sizeBytes: '1024',
    objectKey: 'org/org_1/matters/mtr_1/documents/doc_1/versions/ver_1/source',
    textObjectKey: null,
    documentStatus: 'queued',
    failureReason: null,
    versionNumber: 1,
    contentSha256: 'a'.repeat(64),
    syncState: 'synced',
    createdBy: 'usr_1',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
}

function queryWrapper(client: QueryClient) {
  return ({ children }: PropsWithChildren) =>
    createElement(QueryClientProvider, { client }, children)
}

describe('documentsKeys', () => {
  it('separates by-matter lists from single-document detail keys', () => {
    expect(documentsKeys.byMatter('mtr_1')).toEqual([
      'documents',
      'matter',
      'mtr_1',
    ])
    expect(documentsKeys.detail('doc_1')).toEqual([
      'documents',
      'detail',
      'doc_1',
    ])
  })
})

describe('matterDocumentsQueryOptions', () => {
  it('resolves the documents list through the matters-documents endpoint', async () => {
    api.apiFetch.mockResolvedValueOnce({
      documents: [{ id: 'doc_1', currentVersion: sampleVersion() }],
    })

    const options = matterDocumentsQueryOptions('mtr_1')
    const result = await options.queryFn?.({} as never)

    expect(result).toHaveLength(1)
    expect(result?.[0]?.currentVersion?.filename).toBe('brief.pdf')
    expect(api.apiFetch).toHaveBeenCalledWith('/api/matters/mtr_1/documents')
  })
})

describe('useDeleteDocument', () => {
  it('invalidates redaction-run caches after a cascade delete', async () => {
    api.apiFetch.mockResolvedValueOnce({})
    const client = new QueryClient({
      defaultOptions: {
        mutations: { retry: false },
        queries: { retry: false },
      },
    })
    const invalidate = vi
      .spyOn(client, 'invalidateQueries')
      .mockResolvedValue(undefined)
    const remove = vi.spyOn(client, 'removeQueries')
    const { result } = renderHook(() => useDeleteDocument(), {
      wrapper: queryWrapper(client),
    })

    await act(async () => {
      await result.current.mutateAsync({
        documentId: 'doc_1',
        matterId: 'mtr_1',
      })
    })

    expect(remove).toHaveBeenCalledWith({
      queryKey: documentsKeys.detail('doc_1'),
    })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: documentsKeys.byMatter('mtr_1'),
    })
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['redaction-runs'] })
    expect(invalidate).toHaveBeenCalledWith({
      queryKey: ['document-redaction-runs'],
    })
  })
})

describe('documentQueryOptions', () => {
  it('resolves a document and its versions', async () => {
    api.apiFetch.mockResolvedValueOnce({
      document: { id: 'doc_1', currentVersion: sampleVersion() },
      versions: [sampleVersion()],
    })

    const options = documentQueryOptions('doc_1')
    const result = await options.queryFn?.({} as never)

    expect(result?.document.id).toBe('doc_1')
    expect(result?.versions).toHaveLength(1)
    expect(api.apiFetch).toHaveBeenCalledWith('/api/documents/doc_1')
  })

  it('throws the typed ApiError on a missing document', async () => {
    api.apiFetch.mockRejectedValueOnce(
      new ApiError('document_not_found', 'Document not found.', 404, 'req_2'),
    )

    const options = documentQueryOptions('doc_missing')
    await expect(options.queryFn?.({} as never)).rejects.toMatchObject({
      code: 'document_not_found',
    })
  })
})
