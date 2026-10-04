import { createRoot } from 'react-dom/client'
import type { DocumentModelWire } from '@obiter/contracts'
import {
  StaticDocumentPages,
  layoutDocumentPages,
} from '@obiter/app-shell/document-render'

export interface DocumentRenderResult {
  pageCount: number
  widthPx: number
  heightPx: number
}

declare global {
  interface Window {
    __obiterRenderDocument?: (
      model: DocumentModelWire,
      imageUrls: Record<string, string>,
    ) => Promise<DocumentRenderResult>
  }
}

/** Two frames: one for the commit, one for the painted pixels `page.pdf` captures. */
function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  })
}

/** A data-URL image can still be decoding when the commit paints. */
async function imagesSettled(): Promise<void> {
  await Promise.all(
    Array.from(document.images).map((image) =>
      image.decode().catch(() => undefined),
    ),
  )
}

async function renderDocument(
  model: DocumentModelWire,
  imageUrls: Record<string, string>,
): Promise<DocumentRenderResult> {
  const pages = layoutDocumentPages(model)
  const first = pages[0]
  const container = document.createElement('div')
  document.body.append(container)
  createRoot(container).render(
    <StaticDocumentPages model={model} pages={pages} imageUrls={imageUrls} />,
  )
  await nextPaint()
  await imagesSettled()
  return {
    pageCount: pages.length,
    widthPx: first?.box.widthPx ?? 0,
    heightPx: first?.box.heightPx ?? 0,
  }
}

window.__obiterRenderDocument = renderDocument
