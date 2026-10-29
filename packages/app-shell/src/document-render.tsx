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

export function layoutDocumentPages(model: DocumentModelWire): LaidOutPage[] {
  return layoutDocument(model)
}

const NO_SELECTION = () => undefined

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
