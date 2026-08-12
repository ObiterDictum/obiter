import { describe, expect, it, vi } from 'vitest'
import {
  documentCommentsQueryOptions,
  documentModelQueryOptions,
  documentPdfViewQueryOptions,
  documentTrackedChangesQueryOptions,
} from './document-workspace-api'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))

vi.mock('./api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./api')>()
  return { ...actual, apiFetch: api.apiFetch }
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
