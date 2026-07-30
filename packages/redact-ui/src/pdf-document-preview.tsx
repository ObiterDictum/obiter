import { useEffect, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'

/**
 * Read-only multi-page PDF preview (no span overlays).
 */
export function PdfDocumentPreview({ file }: { file: Blob }) {
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const objectUrl = URL.createObjectURL(file)
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
        setPdf(document)
      } catch (loadError: unknown) {
        if (cancelled) return
        setError(
          loadError instanceof Error
            ? loadError.message
            : 'PDF preview could not be loaded.',
        )
      }
    })
    return () => {
      cancelled = true
      URL.revokeObjectURL(objectUrl)
    }
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
      <p className="text-sm text-muted" role="status">
        Loading PDF…
      </p>
    )
  }

  return (
    <div
      className="flex flex-col items-center gap-4 overflow-x-auto"
      aria-label="Redacted PDF preview"
    >
      {Array.from({ length: pdf.numPages }, (_, index) => (
        <PdfPreviewPage
          key={index}
          pdf={pdf}
          pageNumber={index + 1}
        />
      ))}
    </div>
  )
}

function PdfPreviewPage({
  pdf,
  pageNumber,
}: {
  pdf: PDFDocumentProxy
  pageNumber: number
}) {
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null)

  useEffect(() => {
    if (!canvas) return
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
      }) as { cancel: () => void; promise: Promise<unknown> }
      renderTask = task
      try {
        await task.promise
      } catch {
        // Cancelled or superseded render.
      }
    })
    return () => {
      cancelled = true
      renderTask?.cancel()
    }
  }, [canvas, pdf, pageNumber])

  return (
    <canvas
      ref={setCanvas}
      className="block max-w-full rounded-lg border border-line-strong bg-raised shadow-lg"
    />
  )
}
