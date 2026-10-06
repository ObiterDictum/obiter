import type { DocumentTextRunWire } from '@obiter/contracts'

import { ensureParagraphBookmark } from './document-bookmarks'
import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import { escapeXmlText } from './parts/overlay'
import { spliceInlineXml, spliceRunWires } from './structure-splice'

const BOOKMARK_NAME_PREFIX = '_Ref_'

/**
 * Splices a `REF` field — begin / instrText / separate / result / end — at
 * `offset` in `paragraph`, after ensuring `target` carries a `_Ref_*` bookmark
 * allocated from the part. The result run stores the target's current
 * text as the field result; Word refreshes it on demand. The shared splice
 * closes and reopens a containing run around the field, so a mid-run caret
 * splits the run the same way a page break does.
 */
export function insertCrossReference(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  target: ParagraphAnchor,
  offset: number,
  occurrence: number,
  lineage?: LineageRecorder,
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges || target.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  const result = target.runs.map((run) => run.wire.text).join('')
  const bookmark = ensureParagraphBookmark(
    document,
    target,
    BOOKMARK_NAME_PREFIX,
  )
  spliceInlineXml(
    part.overlay,
    paragraph,
    offset,
    crossReferenceFieldXml(bookmark, result),
    `${paragraph.wire.id}:xref:${String(occurrence)}`,
  )
  part.dirty = true
  const wires = fieldRunWires(document, bookmark, result)
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

function crossReferenceFieldXml(bookmark: string, result: string) {
  return [
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r>',
    `<w:r><w:instrText xml:space="preserve"> REF ${escapeXmlText(bookmark)} </w:instrText></w:r>`,
    '<w:r><w:fldChar w:fldCharType="separate"/></w:r>',
    `<w:r><w:t xml:space="preserve">${escapeXmlText(result)}</w:t></w:r>`,
    '<w:r><w:fldChar w:fldCharType="end"/></w:r>',
  ].join('')
}

/**
 * Five run wires in field order, carrying what a reparse collects: the field
 * characters and the instruction land in `preservedXmlFragments` (non-`w:t`
 * children), and the result run carries the stored result text.
 */
function fieldRunWires(
  document: OoxmlDocument,
  bookmark: string,
  result: string,
): DocumentTextRunWire[] {
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
        `<w:instrText xml:space="preserve"> REF ${escapeXmlText(bookmark)} </w:instrText>`,
      ],
    },
    {
      id: id(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="separate"/>'],
    },
    { id: id(), text: result, preservedXmlFragments: [] },
    {
      id: id(),
      text: '',
      preservedXmlFragments: ['<w:fldChar w:fldCharType="end"/>'],
    },
  ]
}

