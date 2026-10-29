import '@obiter/test-dom'
import { createElement, type PropsWithChildren } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchBlob: vi.fn(),
  apiFetchBlobResult: vi.fn(),
}))

const apiModule = { ...(await import('./api')) }
mock.module('./api', () => ({
  ...apiModule,
  apiFetch: api.apiFetch,
  apiFetchBlob: api.apiFetchBlob,
  apiFetchBlobResult: api.apiFetchBlobResult,
}))

const {
  documentCommentsQueryOptions,
  documentModelQueryOptions,
  documentPdfViewQueryOptions,
  documentTextQueryOptions,
  documentTrackedChangesQueryOptions,
  fetchDocumentDownload,
  fetchDocumentExport,
  useDocumentImageUrls,
} = await import('./document-workspace-api')

function wrapper({ children }: PropsWithChildren) {
  return createElement(
    QueryClientProvider,
    {
      client: new QueryClient({
        defaultOptions: { queries: { retry: false } },
      }),
    },
    children,
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('document workspace query options', () => {
  it('loads the model, pdf view, comments and tracked changes from the M1.25 routes', async () => {
    api.apiFetch.mockResolvedValue({})

    await documentModelQueryOptions('doc_1').queryFn?.({} as never)
    await documentPdfViewQueryOptions('doc_1').queryFn?.({} as never)
    await documentCommentsQueryOptions('doc_1').queryFn?.({} as never)
    await documentTrackedChangesQueryOptions('doc_1').queryFn?.({} as never)

    expect(api.apiFetch.mock.calls.map((call) => call[0])).toEqual([
      '/api/documents/doc_1/model',
      '/api/documents/doc_1/pdf-view',
      '/api/documents/doc_1/comments',
      '/api/documents/doc_1/tracked-changes',
    ])
  })

  it('downloads the DOCX export and surfaces the skipped comment count', async () => {
    api.apiFetchBlobResult.mockResolvedValue({
      blob: new Blob(),
      headers: new Headers({ 'x-obiter-comments-skipped': '2' }),
    })

    await fetchDocumentExport('doc_1')
    await fetchDocumentExport('doc_1', { versionId: 'ver_2' })
    await fetchDocumentExport('doc_1', { shareSafe: true })

    expect(api.apiFetchBlobResult.mock.calls.map((call) => call[0])).toEqual([
      '/api/documents/doc_1/export',
      '/api/documents/doc_1/export?versionId=ver_2',
      '/api/documents/doc_1/export?mode=share-safe',
    ])
    await expect(fetchDocumentExport('doc_1')).resolves.toMatchObject({
      skippedCommentCount: 2,
    })
  })

  it('loads the text view from the txt route', async () => {
    api.apiFetch.mockResolvedValue({ text: 'Plain retrieval text.' })

    await documentTextQueryOptions('doc_1').queryFn?.({} as never)

    expect(api.apiFetch).toHaveBeenCalledWith('/api/documents/doc_1/text')
  })

  it('downloads the stored source bytes from the download route', async () => {
    const blob = new Blob(['Plain retrieval text.'])
    api.apiFetchBlob.mockResolvedValue(blob)

    await expect(fetchDocumentDownload('doc_1')).resolves.toBe(blob)
    expect(api.apiFetchBlob).toHaveBeenCalledWith(
      '/api/documents/doc_1/download',
    )
  })
})

describe('useDocumentImageUrls', () => {
  it('returns a blob object URL instead of a base64 data URL', async () => {
    const createObjectURL = vi.fn(() => 'blob:http://obiter.test/logo')
    Object.assign(URL, {
      createObjectURL,
      revokeObjectURL: vi.fn(),
    })
    api.apiFetchBlob.mockResolvedValue(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    )

    const { result } = renderHook(
      () => useDocumentImageUrls('doc_1', ['word/media/logo.png']),
      { wrapper },
    )

    await waitFor(() => {
      expect(result.current['word/media/logo.png']).toBe(
        'blob:http://obiter.test/logo',
      )
    })
    expect(createObjectURL).toHaveBeenCalled()
    expect(api.apiFetchBlob).toHaveBeenCalledWith(
      '/api/documents/doc_1/media?part=word%2Fmedia%2Flogo.png',
    )
  })

  it('revokes only blob URLs whose part is no longer present', async () => {
    const createObjectURL = vi
      .fn()
      .mockReturnValueOnce('blob:http://obiter.test/logo')
      .mockReturnValueOnce('blob:http://obiter.test/mark')
    const revokeObjectURL = vi.fn()
    Object.assign(URL, { createObjectURL, revokeObjectURL })
    api.apiFetchBlob.mockResolvedValue(
      new Blob([new Uint8Array([137, 80, 78, 71])], { type: 'image/png' }),
    )

    const { result, rerender } = renderHook(
      ({ parts }: { parts: string[] }) => useDocumentImageUrls('doc_1', parts),
      {
        wrapper,
        initialProps: {
          parts: ['word/media/logo.png', 'word/media/mark.png'],
        },
      },
    )

    await waitFor(() => {
      expect(result.current['word/media/logo.png']).toBe(
        'blob:http://obiter.test/logo',
      )
      expect(result.current['word/media/mark.png']).toBe(
        'blob:http://obiter.test/mark',
      )
    })

    rerender({ parts: ['word/media/logo.png'] })
    await waitFor(() => {
      expect(revokeObjectURL).toHaveBeenCalledWith(
        'blob:http://obiter.test/mark',
      )
    })
    expect(revokeObjectURL).not.toHaveBeenCalledWith(
      'blob:http://obiter.test/logo',
    )
  })
})
