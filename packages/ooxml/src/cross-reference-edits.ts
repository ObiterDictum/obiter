import type { DocumentTextRunWire } from '@obiter/contracts'

import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  escapeXmlAttribute,
  escapeXmlText,
  parseXmlElements,
  setOverlayReplacement,
} from './parts/overlay'
import { attributeValue, isWord, WORD_NAMESPACE } from './parts/xml-elements'
import { spliceInlineXml, spliceRunWires } from './structure-splice'

const BOOKMARK_NAME_PREFIX = '_Ref_'
// Word truncates bookmark names at forty characters.
const BOOKMARK_NAME_MAX_LENGTH = 40

/**
 * Splices a `REF` field — begin / instrText / separate / result / end — at
 * `offset` in `paragraph`, after ensuring `target` carries a bookmark whose
 * name derives from its wire id. The result run stores the target's current
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
  const bookmark = ensureBookmark(document, target)
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

/**
 * Ensures `target` carries a bookmark named after its wire id. An existing
 * bookmark with the derived name is reused; otherwise a bookmarkStart/End
 * pair wraps the paragraph's content — after `w:pPr`, before `</w:p>` — so
 * the paragraph's runs become the bookmark's anchor text.
 */
function ensureBookmark(document: OoxmlDocument, target: ParagraphAnchor) {
  const name = bookmarkName(target.wire.id)
  const part = requireEditablePart(document, target.partName)
  const elements = parseXmlElements(part.overlay.source)
  const range = target.paragraphRange
  const existing = elements.find(
    (element) =>
      isWord(element, 'bookmarkStart') &&
      element.start >= range.start &&
      element.end <= range.end &&
      attributeValue(element, WORD_NAMESPACE, 'name') === name,
  )
  if (existing) return name
  // A same-batch bookmark insert is a pending zero-width replacement inside
  // the paragraph, invisible to the source scan — reuse it too. The pending
  // value is a fragment without namespace declarations, so the name is read
  // from the attribute text rather than parsed as a document.
  const pendingName = /<w:bookmarkStart[^>]*\bw:name="([^"]*)"/u
  for (const replacement of part.overlay.replacements.values()) {
    if (
      replacement.start < range.start ||
      replacement.end > range.end ||
      pendingName.exec(replacement.value)?.[1] !== name
    ) {
      continue
    }
    return name
  }
  const paragraphElement = elements.find(
    (element) => isWord(element, 'p') && element.start === range.start,
  )
  if (!paragraphElement) throw new OoxmlError('invalid-document-edit')
  const id = nextBookmarkId(part.overlay.source)
  const bookmarkStart = `<w:bookmarkStart w:id="${String(id)}" w:name="${escapeXmlAttribute(name)}"/>`
  const bookmarkEnd = `<w:bookmarkEnd w:id="${String(id)}"/>`
  if (paragraphElement.selfClosing) {
    refuseCoveringReplacement(part.overlay.replacements, range.start, range.end)
    const opening = part.overlay.source
      .slice(range.start, range.startTagEnd)
      .replace(/\/\s*>$/u, '>')
    setOverlayReplacement(part.overlay, `${target.wire.id}:bookmark`, {
      start: range.start,
      end: range.end,
      value: `${opening}${bookmarkStart}${bookmarkEnd}</w:p>`,
    })
    part.dirty = true
    target.wire.preservedXmlFragments.push(bookmarkStart, bookmarkEnd)
    return name
  }
  const propertiesElement = elements.find(
    (element) =>
      isWord(element, 'pPr') &&
      element.depth === paragraphElement.depth + 1 &&
      element.start >= paragraphElement.startTagEnd &&
      element.end <= paragraphElement.endTagStart,
  )
  const startPoint = propertiesElement
    ? propertiesElement.end
    : paragraphElement.startTagEnd
  const endPoint = paragraphElement.endTagStart
  for (const replacement of part.overlay.replacements.values()) {
    if (replacement.start <= range.start && replacement.end >= range.end) {
      throw new OoxmlError('invalid-document-edit')
    }
    if (
      (replacement.start < startPoint && startPoint < replacement.end) ||
      (replacement.start < endPoint && endPoint < replacement.end)
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  setOverlayReplacement(part.overlay, `${target.wire.id}:bookmark:start`, {
    start: startPoint,
    end: startPoint,
    value: bookmarkStart,
  })
  setOverlayReplacement(part.overlay, `${target.wire.id}:bookmark:end`, {
    start: endPoint,
    end: endPoint,
    value: bookmarkEnd,
  })
  part.dirty = true
  target.wire.preservedXmlFragments.push(bookmarkStart, bookmarkEnd)
  return name
}

function refuseCoveringReplacement(
  replacements: ReadonlyMap<string, { start: number; end: number }>,
  start: number,
  end: number,
) {
  for (const replacement of replacements.values()) {
    if (replacement.start <= start && replacement.end >= end) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

/** A bookmark name Word accepts, derived deterministically from the wire id. */
function bookmarkName(wireId: string) {
  const sanitised = wireId.replace(/[^A-Za-z0-9_]/gu, '_')
  return `${BOOKMARK_NAME_PREFIX}${sanitised}`.slice(
    0,
    BOOKMARK_NAME_MAX_LENGTH,
  )
}

/** The lowest unused `w:id` among the part's existing bookmarkStarts. */
function nextBookmarkId(source: string) {
  let next = 0
  for (const element of parseXmlElements(source)) {
    if (!isWord(element, 'bookmarkStart')) continue
    const raw = attributeValue(element, WORD_NAMESPACE, 'id')
    const value = raw === undefined ? Number.NaN : Number.parseInt(raw, 10)
    if (Number.isInteger(value) && value >= next) next = value + 1
  }
  return next
}
