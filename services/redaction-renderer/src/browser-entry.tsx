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

const RENDER_CONTAINER_ATTRIBUTE = 'data-obiter-render-container'

type RenderSurface = {
  container: HTMLDivElement
  root: ReturnType<typeof createRoot>
}

/**
 * One root for the life of the page. A fresh root per render leaks detached
 * roots and their handlers in the long-lived worker, and `resetPage()` clears
 * `document.body`, so re-attach the same container instead of replacing it.
 */
let surface: RenderSurface | undefined

function ensureSurface(): RenderSurface {
  if (!surface) {
    const container = document.createElement('div')
    container.setAttribute(RENDER_CONTAINER_ATTRIBUTE, '')
    surface = { container, root: createRoot(container) }
  }
  if (!surface.container.isConnected) document.body.append(surface.container)
  return surface
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
  ensureSurface().root.render(
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
