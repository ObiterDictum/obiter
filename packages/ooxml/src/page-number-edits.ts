import type { DocumentTextRunWire } from '@obiter/contracts'

import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import { spliceInlineXml, spliceRunWires } from './structure-splice'

const FIELD_BEGIN = '<w:r><w:fldChar w:fldCharType="begin"/></w:r>'
const FIELD_INSTRUCTION =
  '<w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r>'
const FIELD_SEPARATE = '<w:r><w:fldChar w:fldCharType="separate"/></w:r>'
const FIELD_RESULT = '<w:r><w:t xml:space="preserve"></w:t></w:r>'
const FIELD_END = '<w:r><w:fldChar w:fldCharType="end"/></w:r>'

export function insertPageNumber(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  offset: number,
  occurrence: number,
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  spliceInlineXml(
    part.overlay,
    paragraph,
    offset,
    `${FIELD_BEGIN}${FIELD_INSTRUCTION}${FIELD_SEPARATE}${FIELD_RESULT}${FIELD_END}`,
    `${paragraph.wire.id}:page-number:${String(occurrence)}`,
  )
  part.dirty = true
  const wires = pageNumberRunWires(document)
  spliceRunWires(
    paragraph.wire,
    offset,
    wires,
    () => allocateModelId(document, 'text-edit'),
    lineage,
  )
  if (lineage) {
    for (const wire of wires) {
      lineage.runOrigins.set(wire, [
        { fromRunId: null, fromOffset: 0, toOffset: 0 },
      ])
    }
  }
}

function pageNumberRunWires(document: OoxmlDocument): DocumentTextRunWire[] {
  const id = () => allocateModelId(document, 'text-edit')
  return [
    {
      id: id(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="begin"/>'],
    },
    {
      id: id(),
      text: '',
      preservedXmlFragments: [
        '<w:instrText xml:space="preserve"> PAGE </w:instrText>',
      ],
    },
    {
      id: id(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="separate"/>'],
    },
    { id: id(), text: '', preservedXmlFragments: [] },
    {
      id: id(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="end"/>'],
    },
  ]
}
