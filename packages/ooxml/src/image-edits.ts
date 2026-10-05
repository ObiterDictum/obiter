import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import type { LineageRecorder } from './document-lineage'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  addMediaPart,
  appendRelationship,
  nextDrawingId,
} from './structure-package'
import { spliceInlineXml, spliceRunWires } from './structure-splice'
import { buildInlineDrawingXml, IMAGE_RELATIONSHIP_TYPE } from './structure-xml'

/**
 * An inline picture at a caret offset: a `w:drawing`/`wp:inline`/`a:blip` run
 * with the image bytes in a new `word/media` part and an `r:embed`
 * relationship on the story part — the same shape the reader resolves
 * (`imagePartNameForDrawing`) and paints (`paragraphHasImage`). The extent is
 * the requested pixel size in EMU at 96 dpi, which is how
 * `drawingBoxSize`/`emuToPx` reads it back.
 *
 * The run carries no text, so the paragraph's effective text — and every
 * offset the batch addresses — is unchanged by the splice.
 */
export function insertImage(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  operation: {
    offset: number
    contentType: string
    dataBase64: string
    widthPx: number
    heightPx: number
    name: string
  },
  occurrence: number,
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  const bytes = decodeBase64(operation.dataBase64)
  const partName = addMediaPart(document, operation.contentType, bytes)
  const storyDirectory = paragraph.partName.slice(
    0,
    paragraph.partName.lastIndexOf('/') + 1,
  )
  const relationship = appendRelationship(document, paragraph.partName, {
    type: IMAGE_RELATIONSHIP_TYPE,
    target: partName.slice(storyDirectory.length),
  })
  const docPrId = nextDrawingId(part.overlay)
  const drawingXml = buildInlineDrawingXml({
    widthPx: operation.widthPx,
    heightPx: operation.heightPx,
    relId: relationship.id,
    name: operation.name,
    docPrId,
  })
  const drawingRunXml = `<w:r>${drawingXml}</w:r>`

  spliceInlineXml(
    part.overlay,
    paragraph,
    operation.offset,
    drawingRunXml,
    `${paragraph.wire.id}:image:${String(occurrence)}`,
  )
  part.dirty = true

  // Keep the wire in step with the source: the drawing is one zero-length run
  // carrying the `w:drawing` element as a preserved fragment, exactly as
  // parseRun reports a non-text run child.
  const drawingRun = {
    id: allocateModelId(document, 'text-edit'),
    text: '',
    preservedXmlFragments: [drawingXml],
  }
  spliceRunWires(
    paragraph.wire,
    operation.offset,
    [drawingRun],
    () => allocateModelId(document, 'text-edit'),
    lineage,
  )
  if (lineage) {
    // The drawing run is new content, not a split of an existing run: its
    // reversal origin is null, matching how `recordInsertedParagraph` seeds
    // inserted runs.
    lineage.runOrigins.set(drawingRun, [
      { fromRunId: null, fromOffset: 0, toOffset: 0 },
    ])
  }
}

function decodeBase64(value: string) {
  try {
    const binary = atob(value)
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index)
    }
    return bytes
  } catch {
    throw new OoxmlError('invalid-document-edit')
  }
}
