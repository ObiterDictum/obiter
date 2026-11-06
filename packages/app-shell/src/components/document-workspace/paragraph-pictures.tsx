import type {
  DocumentParagraphWire,
  DocumentRelationshipWire,
} from '@obiter/contracts'
import { paragraphInlinePictures } from '../../document-page-floats'
import { imagePartNameForDrawing } from '../../document-page-media'
import { PageDrawing } from './page-drawing'
import { PictureFrame, type PictureInteraction } from './picture-frame'

export function ParagraphPictures({
  paragraph,
  storyPartName,
  relationships,
  imageUrls,
  columnWidthPx,
  picture,
}: {
  paragraph: DocumentParagraphWire
  storyPartName: string
  relationships: DocumentRelationshipWire[]
  imageUrls: Record<string, string>
  columnWidthPx: number
  picture?: PictureInteraction | undefined
}) {
  return paragraphInlinePictures(paragraph).map(({ xml, runId }, index) => {
    const partName = imagePartNameForDrawing(xml, storyPartName, relationships)
    const imageUrl = partName ? imageUrls[partName] : undefined
    return runId && picture ? (
      <PictureFrame
        key={`${paragraph.id}-img-${index}`}
        xml={xml}
        imageUrl={imageUrl}
        fallbackLabel="Document image"
        paragraphId={paragraph.id}
        runId={runId}
        columnWidthPx={columnWidthPx}
        interaction={picture}
      />
    ) : (
      <PageDrawing
        key={`${paragraph.id}-img-${index}`}
        xml={xml}
        imageUrl={imageUrl}
        fallbackLabel="Document image"
      />
    )
  })
}
