// @vitest-environment jsdom
import { createElement, type PropsWithChildren } from 'react'
import { renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  documentCommentsQueryOptions,
  documentModelQueryOptions,
  documentPdfViewQueryOptions,
  documentTrackedChangesQueryOptions,
  useDocumentImageUrls,
} from './document-workspace-api'

const api = vi.hoisted(() => ({
  apiFetch: vi.fn(),
  apiFetchBlob: vi.fn(),
}))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return {
    ...actual,
    apiFetch: api.apiFetch,
    apiFetchBlob: api.apiFetchBlob,
  }
})

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
  })
})
