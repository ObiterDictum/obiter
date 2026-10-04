import '@obiter/test-dom'
import { act, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { vi } from '../../../scripts/test/vitest-compat'

const pdfjs = vi.hoisted(() => ({
  destroy: vi.fn(async () => undefined),
  render: vi.fn(() => ({
    promise: Promise.resolve(),
    cancel: vi.fn(),
  })),
  getPageCount: vi.fn(),
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
          getPage: async (pageNumber: number) => {
            pdfjs.getPageCount()
            return {
              getViewport: () => ({ width: 100, height: 120 }),
              render: pdfjs.render,
              pageNumber,
            }
          },
        }),
  }),
}))

const { PdfDocumentPreview } = await import('./pdf-document-preview')

// jsdom has no canvas backend; the component only needs a truthy 2D context
// object to proceed to the render task, which the pdf.js mock drives.
HTMLCanvasElement.prototype.getContext = (() => ({})) as never

beforeEach(() => {
  pdfjs.render.mockClear()
  pdfjs.getPageCount.mockClear()
  pdfjs.getDocumentError = null
})

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
  })

  it('does not render every page at once, only pages near the viewport', async () => {
    class MockIntersectionObserver {
      static instances: MockIntersectionObserver[] = []
      readonly callback: IntersectionObserverCallback
      target: Element | null = null
      constructor(callback: IntersectionObserverCallback) {
        this.callback = callback
        MockIntersectionObserver.instances.push(this)
      }
      observe(target: Element) {
        this.target = target
      }
      unobserve() {}
      disconnect() {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
      intersect() {
        this.callback(
          [{ isIntersecting: true, target: this.target } as never],
          this as never,
        )
      }
    }
    globalThis.IntersectionObserver = MockIntersectionObserver as never
    try {
      const onStatusChange = vi.fn()
      render(<PdfDocumentPreview file={file} onStatusChange={onStatusChange} />)

      await waitFor(() => {
        expect(MockIntersectionObserver.instances).toHaveLength(3)
      })
      // Labels exist for every page, but no canvas has rendered yet.
      expect(screen.getByText('Page 1 of 3')).toBeTruthy()
      expect(screen.getByText('Page 3 of 3')).toBeTruthy()
      expect(pdfjs.render).not.toHaveBeenCalled()
      expect(pdfjs.getPageCount).not.toHaveBeenCalled()

      act(() => MockIntersectionObserver.instances[0]?.intersect())
      await waitFor(() => expect(pdfjs.render).toHaveBeenCalledTimes(1))
      expect(onStatusChange).toHaveBeenCalledWith({
        kind: 'ready',
        pageCount: 3,
      })

      // Page 3 entering the viewport renders only page 3, not page 2.
      act(() => MockIntersectionObserver.instances[2]?.intersect())
      await waitFor(() => expect(pdfjs.render).toHaveBeenCalledTimes(2))
    } finally {
      delete (globalThis as { IntersectionObserver?: unknown })
        .IntersectionObserver
    }
  })
})
