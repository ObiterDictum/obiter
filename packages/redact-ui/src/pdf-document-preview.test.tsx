import '@obiter/test-dom'
import { render, screen, waitFor } from '@testing-library/react'
import { describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const pdfjs = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  render: vi.fn(() => ({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  })),
  getDocumentError: null as Error | null,
}))

mock.module('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: () => ({
    promise: pdfjs.getDocumentError
      ? Promise.reject(pdfjs.getDocumentError)
      : Promise.resolve({
          numPages: 3,
          destroy: pdfjs.destroy,
          getPage: async () => ({
            getViewport: () => ({ width: 100, height: 120 }),
            render: pdfjs.render,
          }),
        }),
  }),
}))

const { PdfDocumentPreview } = await import('./pdf-document-preview')

// jsdom has no canvas backend; the component only needs a truthy 2D context
// object to proceed to the render task, which the pdf.js mock drives.
HTMLCanvasElement.prototype.getContext = (() => ({})) as never

const file = new Blob(['%PDF-preview'], { type: 'application/pdf' })

describe('PdfDocumentPreview', () => {
  it('reports preview-ready only after the first page renders, with page labels', async () => {
    const onStatusChange = vi.fn()
    render(<PdfDocumentPreview file={file} onStatusChange={onStatusChange} />)

    expect(screen.getByText('Loading the finalized PDF…')).toBeTruthy()

    await waitFor(() => {
      expect(screen.getByText('Page 1 of 3')).toBeTruthy()
    })
    expect(screen.getByText('Page 2 of 3')).toBeTruthy()
    expect(screen.getByText('Page 3 of 3')).toBeTruthy()
    expect(onStatusChange).toHaveBeenCalledWith({ kind: 'ready', pageCount: 3 })
  })

  it('reports an error and does not claim preview readiness', async () => {
    pdfjs.getDocumentError = new Error('corrupt pdf')
    const onStatusChange = vi.fn()
    render(<PdfDocumentPreview file={file} onStatusChange={onStatusChange} />)

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeTruthy()
    })
    expect(screen.getByRole('alert').textContent).toContain('corrupt pdf')
    expect(onStatusChange).toHaveBeenCalledWith({
      kind: 'error',
      message: 'corrupt pdf',
    })
    expect(screen.queryByText(/Preview ready/)).toBeNull()
    pdfjs.getDocumentError = null
  })
})
