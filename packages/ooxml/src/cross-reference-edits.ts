import type { DocumentTextRunWire } from '@obiter/contracts'

import { ensureParagraphBookmark } from './document-bookmarks'
import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import { escapeXmlText } from './parts/overlay'
import { spliceInlineXml, spliceRunWires } from './structure-splice'

const BOOKMARK_NAME_PREFIX = '_Ref_'

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
