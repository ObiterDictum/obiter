import type { DocumentModelWire } from '@obiter/contracts'
import { layoutDocument, type LaidOutPage } from './document-page-engine'
import { documentSections, pageBoxForSection } from './document-page-layout'
import { documentDefaultFace } from './document-page-style'
import {
  DocumentDesk,
  DocumentPage,
  DocumentPrintStyle,
} from './components/document-workspace/document-page'
import { DocumentModelPage } from './components/document-workspace/model-view'

export type { LaidOutPage }

/**
 * Paginates one DOCX model with the workspace's own engine. The document
 * workspace wraps the same call in draft state and TanStack Query; the
 * redaction renderer worker calls it directly, so both paint one pagination
 * implementation rather than a server-side reimplementation that would break
 * lines differently from the browser.
 */
export function layoutDocumentPages(model: DocumentModelWire): LaidOutPage[] {
  return layoutDocument(model)
}

const NO_SELECTION = () => undefined

/**
 * Read-only pages for a document model. The workspace's interactive props are
 * omitted rather than stubbed with behaviour: no caret, selection, presence,
 * draft, insert or tracked-change editing path is reachable, so the painted
 * page is exactly what the engine laid out. `pages` is passed in so the caller
 * measures the same layout it renders.
 */
export function StaticDocumentPages({
  model,
  pages,
  imageUrls = {},
}: {
  model: DocumentModelWire
  pages: LaidOutPage[]
  imageUrls?: Record<string, string>
}) {
  const fontFamily = documentDefaultFace(model.styles).fontFamily
  return (
    <DocumentDesk>
      <div className="mx-auto flex w-max max-w-full flex-col items-start gap-6">
        <div className="flex w-full flex-col gap-6">
          {/* `@page` is the document's stored first-section box, derived from
              the model rather than a painted page so no layout flow's
              internal frame can reach the print contract. */}
          <DocumentPrintStyle
            box={pageBoxForSection(documentSections(model)[0]?.xml ?? '')}
          />
          {pages.map((laid, index) => (
            <DocumentPage
              key={`page-${index + 1}`}
              width={laid.box.widthPx}
              height={laid.box.heightPx}
              fontFamily={fontFamily}
            >
              <DocumentModelPage
                model={model}
                pageNumber={index + 1}
                pageBlocks={laid.blocks}
                pageFloats={laid.floats}
                pageTextBoxes={laid.textBoxes}
                pageLayout={laid}
                selectedParagraphId={null}
                onSelectParagraph={NO_SELECTION}
                imageUrls={imageUrls}
              />
            </DocumentPage>
          ))}
        </div>
      </div>
    </DocumentDesk>
  )
}
