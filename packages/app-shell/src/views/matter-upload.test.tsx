import '@obiter/test-dom'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../../scripts/test/vitest-compat'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { Toaster, ToastProvider } from '@obiter/ui'

const api = vi.hoisted(() => ({ apiFetch: vi.fn() }))
const apiModule = { ...(await import('../api')) }
mock.module('../api', () => ({ ...apiModule, apiFetch: api.apiFetch }))

const { MatterDropZone, MatterUploadButton } = await import('./matter-upload')

function file(name: string) {
  return new File(['synthetic'], name, { type: 'text/plain' })
}

function uploaded(name: string) {
  return {
    document: { id: `doc_${name}` },
    version: { filename: name },
  }
}

function renderUploads() {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ToastProvider>
        <MatterDropZone matterId="mtr_1">
          <p>Documents</p>
        </MatterDropZone>
        <MatterUploadButton matterId="mtr_1" />
        <Toaster />
      </ToastProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  vi.clearAllMocks()
})

afterEach(cleanup)

describe('matter document uploads', () => {
  it('uploads every file in a drop, one after another', async () => {
    api.apiFetch.mockImplementation(
      async (_path: string, init?: RequestInit) => {
        const form = init?.body as FormData
        return uploaded((form.get('file') as File).name)
      },
    )
    renderUploads()

    fireEvent.drop(screen.getByText('Documents'), {
      dataTransfer: {
        types: ['Files'],
        files: [file('first.docx'), file('second.pdf')],
      },
    })

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(2))
    expect(
      api.apiFetch.mock.calls.map((call) =>
        ((call[1] as RequestInit).body as FormData).get('file'),
      ),
    ).toMatchObject([{ name: 'first.docx' }, { name: 'second.pdf' }])
    expect(await screen.findByText('first.docx')).toBeTruthy()
    expect(await screen.findByText('second.pdf')).toBeTruthy()
  })

  it('accepts several files in the file picker', async () => {
    api.apiFetch.mockImplementation(
      async (_path: string, init?: RequestInit) => {
        const form = init?.body as FormData
        return uploaded((form.get('file') as File).name)
      },
    )
    renderUploads()

    const input = screen.getByLabelText('Upload document')
    expect(input).toHaveProperty('multiple', true)
    fireEvent.change(input, {
      target: { files: [file('first.docx'), file('second.pdf')] },
    })

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(2))
  })

  it('names the failed file and still uploads the rest', async () => {
    api.apiFetch
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockImplementationOnce(async (_path: string, init?: RequestInit) => {
        const form = init?.body as FormData
        return uploaded((form.get('file') as File).name)
      })
    renderUploads()

    fireEvent.drop(screen.getByText('Documents'), {
      dataTransfer: {
        types: ['Files'],
        files: [file('broken.docx'), file('second.pdf')],
      },
    })

    await waitFor(() => expect(api.apiFetch).toHaveBeenCalledTimes(2))
    expect(
      await screen.findByText(/broken\.docx: storage unavailable/),
    ).toBeTruthy()
    expect(await screen.findByText('second.pdf')).toBeTruthy()
  })
})
