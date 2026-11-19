import { memo, useMemo } from 'react'
import { pageReferenceMap } from './document-page-references'
import {
  DocumentRunPaintContext,
  type PaintDocumentRun,
} from './components/document-workspace/document-run-paint'
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

export type { LaidOutPage, PaintDocumentRun }
export { documentImagePartNames } from './document-page-media'
export { useSourceImageUrls } from './document-workspace-downloads'

export function layoutDocumentPages(model: DocumentModelWire): LaidOutPage[] {
  return layoutDocument(model)
}

const NO_SELECTION = () => undefined
const NO_IMAGES: Record<string, string> = {}

export function StaticDocumentPages({
  model,
  pages,
  imageUrls = NO_IMAGES,
  zoom = 100,
  pageLimit = pages.length,
  paintRun,
}: {
  model: DocumentModelWire
  pages: LaidOutPage[]
  imageUrls?: Record<string, string>
  zoom?: number
  pageLimit?: number
  paintRun?: PaintDocumentRun
}) {
  const pageReferences = useMemo(
    () => pageReferenceMap(model, pages),
    [model, pages],
  )
  const fontFamily = documentDefaultFace(model.styles).fontFamily
  return (
    <DocumentDesk paperWidth={pages[0]?.box.widthPx ?? null}>
      <div className="mx-auto flex w-max max-w-full flex-col items-start gap-6">
        <div className="flex w-full flex-col gap-6">
          <DocumentPrintStyle
            box={pageBoxForSection(documentSections(model)[0]?.xml ?? '')}
          />
          <DocumentRunPaintContext value={paintRun ?? null}>
            {pages.slice(0, pageLimit).map((page, index) => (
              <StaticPage
                key={index}
                page={page}
                pageNumber={index + 1}
                model={model}
                pageReferences={pageReferences}
                imageUrls={imageUrls}
                zoom={zoom}
                fontFamily={fontFamily}
              />
            ))}
          </DocumentRunPaintContext>
        </div>
      </div>
    </DocumentDesk>
  )
}

const StaticPage = memo(function StaticPage({
  page,
  pageNumber,
  model,
  pageReferences,
  imageUrls,
  zoom,
  fontFamily,
}: {
  page: LaidOutPage
  pageNumber: number
  model: DocumentModelWire
  pageReferences: ReadonlyMap<string, number>
  imageUrls: Record<string, string>
  zoom: number
  fontFamily?: string
}) {
  return (
    <DocumentPage
      zoom={zoom}
      width={page.box.widthPx}
      height={page.box.heightPx}
      fontFamily={fontFamily}
    >
      <DocumentModelPage
        model={model}
        pageNumber={pageNumber}
        pageReferences={pageReferences}
        pageBlocks={page.blocks}
        pageFloats={page.floats}
        pageTextBoxes={page.textBoxes}
        pageLayout={page}
        selectedParagraphId={null}
        onSelectParagraph={NO_SELECTION}
        imageUrls={imageUrls}
      />
    </DocumentPage>
  )
})
