import '@obiter/test-dom'
import { fireEvent, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'bun:test'
import { ApiError } from '../../api'
import { mountWorkspace } from './docx-workspace-harness'

describe('document model load failure', () => {
  it('shows an error state with the request id and a retry that refetches', () => {
    const refetch = vi.fn()
    mountWorkspace({
      modelFailure: {
        error: new ApiError(
          'storage_unavailable',
          'The document model could not be built.',
          500,
          'req_42',
        ),
      },
      modelRefetch: refetch,
    })
    expect(screen.getByText('This document could not be loaded')).toBeTruthy()
    expect(screen.getByText(/req_42/)).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    expect(refetch).toHaveBeenCalled()
  })

  it('explains a missing stored file without offering a retry', () => {
    mountWorkspace({
      modelFailure: {
        error: new ApiError(
          'document_file_missing',
          'The stored file for this document is missing.',
          410,
          'req_43',
        ),
      },
    })
    expect(screen.getByText("This document's file is missing")).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Retry' })).toBeNull()
  })
})
