import '@obiter/test-dom'
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'
import type { RedactionSpan } from '@obiter/redaction-policy'
import type { DocumentTextLayout } from './types'

const pdfjs = vi.hoisted(() => ({
  failingPages: new Set<number>(),
  getDocumentError: null as Error | null,
  getDocumentCalls: 0,
}))

mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => {
    pdfjs.getDocumentCalls += 1
    return {
      promise: pdfjs.getDocumentError
        ? Promise.reject(pdfjs.getDocumentError)
        : Promise.resolve({
            numPages: 2,
            destroy: async () => undefined,
            getPage: async (pageNumber: number) => ({
              getViewport: ({ scale }: { scale: number }) => ({
                width: 100 * scale,
                height: 120 * scale,
                convertToViewportRectangle: (rect: number[]) => rect,
              }),
              render: () =>
                pdfjs.failingPages.has(pageNumber)
                  ? {
                      promise: Promise.reject(new Error('page broke')),
                      cancel: vi.fn(),
                    }
                  : { promise: Promise.resolve(), cancel: vi.fn() },
            }),
          }),
    }
  },
}))

const { PdfReviewDocument } = await import('./pdf-review-document')

HTMLCanvasElement.prototype.getContext = (() => ({})) as never

const layout: DocumentTextLayout = {
  version: 1,
  pages: [
    { width: 100, height: 120 },
    { width: 100, height: 120 },
  ],
  segments: [
    { start: 0, end: 11, pageIndex: 0, x: 10, y: 20, width: 60, height: 10 },
    { start: 12, end: 21, pageIndex: 1, x: 10, y: 20, width: 60, height: 10 },
  ],
}

function span(
  overrides: Partial<RedactionSpan> & { id: string },
): RedactionSpan {
  return {
    start: 0,
    end: 5,
    text: 'Alice',
    category: 'person_name',
    source: 'rampart_model',
    confidence: 'high',
    suggestion: 'redact',
    ...overrides,
  }
}

const spans = [
  span({ id: 'span_page_1' }),
  span({ id: 'span_page_2', start: 12, end: 15, text: 'Bob' }),
]

const firstFile = new Blob(['%PDF-one'], { type: 'application/pdf' })
const secondFile = new Blob(['%PDF-two'], { type: 'application/pdf' })

function review(file: Blob) {
  return (
    <PdfReviewDocument
      file={file}
      layout={layout}
      spans={spans}
      decisions={{}}
      selectedId={null}
      onSelect={vi.fn()}
      categoryClassName={{}}
    />
  )
}

beforeEach(() => {
  pdfjs.failingPages.clear()
  pdfjs.getDocumentError = null
  pdfjs.getDocumentCalls = 0
  const urlApi = URL as unknown as {
    createObjectURL?: (blob: Blob) => string
    revokeObjectURL?: (url: string) => void
  }
  urlApi.createObjectURL ??= () => 'blob:missing'
  urlApi.revokeObjectURL ??= () => undefined
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:review')
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('PdfReviewDocument', () => {
  it('shows a retry on the page that failed and keeps the other pages rendered', async () => {
    pdfjs.failingPages.add(2)
    render(review(firstFile))

    await waitFor(() => {
      expect(screen.getByText('This page could not be displayed.')).toBeTruthy()
    })
    expect(
      screen.getAllByText('This page could not be displayed.'),
    ).toHaveLength(1)
    expect(screen.getByRole('button', { name: 'Try again' })).toBeTruthy()
    expect(
      screen.getByRole('button', { name: 'person name: Alice' }),
    ).toBeTruthy()
  })

  it('redraws the failed page when the retry is used', async () => {
    pdfjs.failingPages.add(2)
    render(review(firstFile))

    fireEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    pdfjs.failingPages.clear()

    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'person name: Bob' }),
      ).toBeTruthy()
    })
    expect(screen.queryByText('This page could not be displayed.')).toBeNull()
  })

  it('clears a failed page when the file changes', async () => {
    pdfjs.failingPages.add(2)
    const { rerender } = render(review(firstFile))
    await screen.findByText('This page could not be displayed.')

    pdfjs.failingPages.clear()
    rerender(review(secondFile))

    await waitFor(() => {
      expect(screen.queryByText('This page could not be displayed.')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'person name: Bob' }),
      ).toBeTruthy()
    })
  })

  it('clears a document load failure when the file changes', async () => {
    pdfjs.getDocumentError = new Error('corrupt pdf')
    const { rerender } = render(review(firstFile))
    expect(await screen.findByRole('alert')).toHaveProperty(
      'textContent',
      'corrupt pdf',
    )

    pdfjs.getDocumentError = null
    rerender(review(secondFile))

    await waitFor(() => {
      expect(screen.queryByText('corrupt pdf')).toBeNull()
      expect(
        screen.getByRole('button', { name: 'person name: Alice' }),
      ).toBeTruthy()
    })
  })
})
