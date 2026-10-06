import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

export type PdfPreviewStatus =
  | { kind: 'loading' }
  | { kind: 'ready'; pageCount: number }
  | { kind: 'error'; message: string }

/**
 * Read-only multi-page PDF preview (no span overlays).
 *
 * Pages render lazily: a page mounts its canvas and starts a pdf.js render only
 * when it scrolls near the viewport, so a several-hundred-page secure PDF does
 * not allocate every page bitmap at once. Readiness is still reported only
 * after page 1 has actually rendered; loading the document is not enough. The
 * parent owns the download; this component only renders the bytes it is given
 * and never substitutes another source.
 */
export function PdfDocumentPreview({
  file,
  onStatusChange,
  ariaLabel = 'Finalized PDF preview',
}: {
  file: Blob
  onStatusChange?: (status: PdfPreviewStatus) => void
  ariaLabel?: string
}) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pageCount, setPageCount] = useState(0)
  const [firstPageRendered, setFirstPageRendered] = useState(false)
  // The loaded document owns a pdf.js worker port and its decoded pages. Hold
  // it so unmount or a new Blob can destroy it instead of leaking both.
  const loadedDocument = useRef<PDFDocumentProxy | null>(null)

  useEffect(() => {
    let cancelled = false
    void import('pdfjs-dist').then(async (pdfjs) => {
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        'pdfjs-dist/build/pdf.worker.min.mjs',
        import.meta.url,
      ).toString()
      try {
        // Copy bytes — pdf.js may detach the underlying ArrayBuffer.
        const buffer = await file.arrayBuffer()
        const document = await pdfjs.getDocument({
          data: Uint8Array.from(new Uint8Array(buffer)),
        }).promise
        if (cancelled) {
          void document.destroy()
          return
        }
        loadedDocument.current = document
        setPdf(document)
        setPageCount(document.numPages)
      } catch (loadError: unknown) {
        if (cancelled) return
        const message =
          loadError instanceof Error
            ? loadError.message
            : 'PDF preview could not be loaded.'
        setError(message)
        onStatusChange?.({ kind: 'error', message })
      }
    })
    return () => {
      cancelled = true
      const document = loadedDocument.current
      loadedDocument.current = null
      if (document) void document.destroy()
    }
    // The preview is keyed to one immutable artifact Blob; a new Blob means a
    // different artifact and must reload.
  }, [file])

  if (error) {
    return (
      <p className="text-sm text-danger" role="alert">
        {error}
      </p>
    )
  }

  if (!pdf) {
    return (
      <div
        className="flex w-full max-w-[820px] flex-col gap-3"
        role="status"
        aria-live="polite"
      >
        <p className="text-sm text-muted">Loading the finalized PDF…</p>
        <div className="h-[520px] w-full animate-pulse rounded-lg border border-line bg-raised" />
        <div className="h-[520px] w-full animate-pulse rounded-lg border border-line bg-raised" />
      </div>
    )
  }

  return (
    <div className="flex flex-col items-center gap-4" aria-label={ariaLabel}>
      {!firstPageRendered ? (
        <p className="self-start text-sm text-muted" role="status">
          Loading the finalized PDF…
        </p>
      ) : null}
      <div className="flex w-full flex-col items-center gap-6 overflow-x-auto">
        {Array.from({ length: pdf.numPages }, (_, index) => (
          <PdfPreviewPage
            key={index}
            pdf={pdf}
            pageNumber={index + 1}
            pageCount={pageCount}
            onFirstPageRendered={() => {
              if (index !== 0 || firstPageRendered) return
              setFirstPageRendered(true)
              onStatusChange?.({ kind: 'ready', pageCount })
            }}
          />
        ))}
      </div>
    </div>
  )
}

/** Distance ahead of the viewport at which a page starts rendering. */
const RENDER_ROOT_MARGIN = '800px 0px'

function PdfPreviewPage({
  pdf,
  pageNumber,
  pageCount,
  onFirstPageRendered,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
  pageCount: number
  onFirstPageRendered: () => void
}) {
  const placeholder = useRef<HTMLElement | null>(null)
  // Environments without IntersectionObserver (jsdom, older engines) render
  // eagerly rather than never: the preview must still work, just without the
  // memory saving.
  const [visible, setVisible] = useState(
    () => typeof IntersectionObserver === 'undefined',
  )
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (visible) return
    const element = placeholder.current
    if (!element) return
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) setVisible(true)
      },
      { rootMargin: RENDER_ROOT_MARGIN },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [visible])

  useEffect(() => {
    if (!visible || !canvas) return
    let cancelled = false
    let renderTask: { cancel: () => void; promise: Promise<unknown> } | null =
      null
    void pdf.getPage(pageNumber).then(async (page) => {
      const viewport = page.getViewport({ scale: 1.25 })
      if (cancelled) return
      canvas.width = viewport.width
      canvas.height = viewport.height
      canvas.style.width = `${viewport.width}px`
      canvas.style.height = `${viewport.height}px`
      const context = canvas.getContext('2d')
      if (!context) return
      const task = page.render({
        canvasContext: context,
        viewport,
        canvas,
      })
      renderTask = task
      try {
        await task.promise
        if (pageNumber === 1) onFirstPageRendered()
      } catch {
        // Cancelled or superseded render.
      }
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
    // The render callback depends on canvas identity, document and page only.
  }, [canvas, pdf, pageNumber, visible])

  return (
    <figure
      ref={placeholder}
      className="flex w-full max-w-[820px] flex-col items-center gap-2"
    >
      <figcaption className="self-start text-xs font-medium text-muted">
        Page {pageNumber} of {pageCount}
      </figcaption>
      {visible ? (
        <canvas
          ref={setCanvas}
          className="block w-full max-w-full rounded-lg border border-line-strong bg-raised shadow-lg"
        />
      ) : (
        <div
          className="h-[520px] w-full animate-pulse rounded-lg border border-line bg-raised"
          aria-hidden="true"
        />
      )}
    </figure>
  )
}
