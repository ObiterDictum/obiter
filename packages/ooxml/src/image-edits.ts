import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import type { LineageRecorder } from './document-lineage'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  addMediaPart,
  appendRelationship,
  nextDrawingId,
  relationshipsPartName,
} from './structure-package'
import { spliceInlineXml, spliceRunWires } from './structure-splice'
import { buildInlineDrawingXml, IMAGE_RELATIONSHIP_TYPE } from './structure-xml'

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
  const partName = addMediaPart(document, operation.contentType, bytes, [
    relationshipsPartName(paragraph.partName),
  ])
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
