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

/**
 * Splices a `PAGE` field — begin / instrText / separate / result / end — at
 * `offset` in `paragraph`, in whichever editable part the anchor lives in:
 * the body, or a header/footer story part. The result run stores no text:
 * the reader resolves the number from the instruction at paint time, so a
 * stored result would paint a second, stale number beside it, and Word
 * recomputes a `PAGE` field on every repagination rather than reading the
 * stored result. The shared splice closes and reopens a containing run
 * around the field, so a mid-run caret splits the run the same way a
 * cross-reference does.
 */
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
    // The field runs are new content, not a split of an existing run: their
    // reversal origin is null, matching inserted-paragraph seeding.
    for (const wire of wires) {
      lineage.runOrigins.set(wire, [
        { fromRunId: null, fromOffset: 0, toOffset: 0 },
      ])
    }
  }
}

/**
 * Five run wires in field order, carrying what a reparse collects: the field
 * characters and the instruction land in `preservedXmlFragments` (non-`w:t`
 * children), and the result run carries the stored result — nothing for a
 * `PAGE` field, so the painted paragraph's text is exactly the text the user
 * typed around the field.
 */
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
