import {
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES,
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES,
} from '@obiter/contracts'
import type { DocumentStoryWire } from '@obiter/contracts'

import { ensureParagraphBookmark } from './document-bookmarks'
import {
  recordDeletedParagraph,
  recordInsertedParagraph,
  type LineageRecorder,
} from './document-lineage'
import {
  fieldInstructionsInXml,
  isTableOfAuthoritiesField,
  tableAuthorityMarkMatches,
} from './field-instructions'
import {
  fieldSpans,
  spanNestedInField,
  spanRangeReplaceable,
} from './field-spans'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { effectiveRunView, runHasPendingOverlay } from './run-effective'
import { locateOffset } from './text-offsets'
import { nextSyntheticParaId } from './structure-package'
import {
  runHoldingOffset,
  spliceInlineXml,
  spliceRunWires,
} from './structure-splice'
import { tableOfAuthoritiesCitations } from './table-of-authorities-entries'
import { sectionColumnWidthTwips } from './table-of-contents-xml'
import {
  tableAuthorityMarkWires,
  tableAuthorityMarkXml,
  toaEntryParagraphWire,
  toaEntryParagraphXml,
  toaHeadingParagraphWire,
  toaHeadingParagraphXml,
  type ToaEntry,
} from './table-of-authorities-xml'

const TOA_BOOKMARK_PREFIX = '_ToA'

export function updateTableOfAuthorities(
  document: OoxmlDocument,
  story: DocumentStoryWire,
  paragraph: ParagraphAnchor,
  deletedIds: ReadonlySet<string>,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  const overlay = part.overlay
  const source = overlay.source
  const elements = parseXmlElements(source)
  const headElement = elements.find(
    (element) => element.start === paragraph.paragraphRange.start,
  )
  if (!headElement || !isWord(headElement, 'p')) {
    throw new OoxmlError('invalid-document-edit')
  }

  const spans = fieldSpans(elements, source)
  const span = spans.find(
    (candidate) =>
      candidate.beginParagraph === headElement &&
      isTableOfAuthoritiesField(candidate.instruction),
  )
  if (
    span === undefined ||
    !spanRangeReplaceable(span) ||
    spanNestedInField(spans, span)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
  const endElement = span.endParagraph
  if (!endElement) throw new OoxmlError('invalid-document-edit')

  const expectedStarts = new Set(
    span.rangeParagraphs
      .filter((element) => element !== endElement)
      .map((element) => element.start),
  )
  const removedIds = new Set<string>()
  for (const [id, anchor] of document.paragraphAnchors) {
    if (anchor.partName !== paragraph.partName) continue
    if (
      anchor.paragraphRange.start >= headElement.start &&
      anchor.paragraphRange.end <= endElement.start
    ) {
      removedIds.add(id)
      expectedStarts.delete(anchor.paragraphRange.start)
      if (anchor.hasTrackedChanges) {
        throw new OoxmlError('model-node-not-editable')
      }
    }
  }
  if (expectedStarts.size > 0) {
    throw new OoxmlError('invalid-document-edit')
  }
  for (const pending of overlay.replacements.values()) {
    if (pending.start < endElement.start && pending.end > headElement.start) {
      throw new OoxmlError('invalid-document-edit')
    }
  }

  const { occurrences, entries } = tableOfAuthoritiesCitations(story.paragraphs)
  const anchors = new Map<string, ParagraphAnchor>()
  for (const id of new Set([
    ...entries.flatMap((entry) => entry.paragraphIds),
    ...occurrences.map((hit) => hit.paragraphId),
  ])) {
    if (deletedIds.has(id) || removedIds.has(id)) continue
    const anchor = document.paragraphAnchors.get(id)
    if (!anchor) continue
    if (anchor.hasTrackedChanges) {
      throw new OoxmlError('model-node-not-editable')
    }
    anchors.set(id, anchor)
  }
  const liveEntries = entries
    .map((entry) => ({
      ...entry,
      paragraphIds: entry.paragraphIds.filter((id) => anchors.has(id)),
    }))
    .filter((entry) => entry.paragraphIds.length > 0)
  const liveOccurrences = occurrences.filter((hit) =>
    anchors.has(hit.paragraphId),
  )
  if (
    liveEntries.length === 0 ||
    liveEntries.length > DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES ||
    liveOccurrences.length > DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES
  ) {
    throw new OoxmlError('invalid-document-edit')
  }

  const nextRunId = () => allocateModelId(document, 'text-edit')
  liveOccurrences.forEach((hit, index) => {
    const anchor = anchors.get(hit.paragraphId)
    if (!anchor) return
    if (authorityMarkAt(overlay, anchor, hit.end, hit.citation)) return
    spliceInlineXml(
      overlay,
      anchor,
      hit.end,
      tableAuthorityMarkXml(hit.citation),
      `${anchor.wire.id}:ta:${String(index)}`,
    )
    spliceRunWires(
      anchor.wire,
      hit.end,
      tableAuthorityMarkWires(nextRunId, hit.citation),
      nextRunId,
      lineage?.recorder,
    )
  })

  const toaEntries: ToaEntry[] = liveEntries.map((entry) => ({
    ...entry,
    bookmarks: entry.paragraphIds.map((id) => {
      const anchor = anchors.get(id)
      if (!anchor) throw new OoxmlError('invalid-document-edit')
      return ensureParagraphBookmark(document, anchor, TOA_BOOKMARK_PREFIX)
    }),
  }))

  const headingParaId = nextSyntheticParaId(overlay)
  const paraIds = toaEntries.map(() => nextSyntheticParaId(overlay))
  const tabPosition = sectionColumnWidthTwips(
    elements,
    paragraph.paragraphRange.end,
  )
  setOverlayReplacement(overlay, `${paragraph.wire.id}:toa-update`, {
    start: headElement.start,
    end: endElement.start,
    value:
      toaHeadingParagraphXml(headingParaId) +
      toaEntries
        .map((entry, index) =>
          toaEntryParagraphXml(entry, paraIds[index] ?? '', tabPosition),
        )
        .join(''),
  })
  part.dirty = true

  const headIndex = story.paragraphs.indexOf(paragraph.wire)
  const tailIndex = story.paragraphs.findIndex(
    (wire, index) =>
      index > headIndex &&
      document.paragraphAnchors.get(wire.id)?.paragraphRange.start ===
        endElement.start,
  )
  if (headIndex === -1 || tailIndex === -1) {
    throw new OoxmlError('invalid-document-edit')
  }
  const removedWires = story.paragraphs.slice(headIndex, tailIndex)
  const insertedWires = [
    toaHeadingParagraphWire(nextRunId, headingParaId),
    ...toaEntries.map((entry, index) =>
      toaEntryParagraphWire(
        nextRunId,
        entry,
        paraIds[index] ?? '',
        tabPosition,
      ),
    ),
  ]
  story.paragraphs.splice(headIndex, tailIndex - headIndex, ...insertedWires)
  for (const wire of removedWires) {
    document.paragraphAnchors.delete(wire.id)
    for (const run of wire.runs) document.textRunAnchors.delete(run.id)
    if (lineage) {
      recordDeletedParagraph(lineage.recorder, wire, lineage.operationIndex)
    }
  }
  if (lineage) {
    for (const wire of insertedWires) {
      recordInsertedParagraph(lineage.recorder, wire, lineage.operationIndex)
    }
  }
}

function authorityMarkAt(
  overlay: XmlOverlay,
  anchor: ParagraphAnchor,
  offset: number,
  citation: string,
) {
  const marked = (xml: string) =>
    fieldInstructionsInXml(xml).some((instruction) =>
      tableAuthorityMarkMatches(instruction, citation),
    )
  const holder = runHoldingOffset(anchor, offset)
  if (holder && runHasPendingOverlay(overlay, holder.run)) {
    const view = effectiveRunView(overlay, holder.run, anchor)
    const point = locateOffset(
      view.source,
      view.paragraph,
      offset - holder.runStart,
      true,
    )
    const tail = markupPrecedes(view.source, point.sourceOffset)
    return tail !== undefined && marked(tail)
  }
  const point = locateOffset(overlay.source, anchor, offset, true)
  for (const pending of overlay.replacements.values()) {
    if (pending.start === point.sourceOffset && marked(pending.value)) {
      return true
    }
  }
  const tail = markupPrecedes(overlay.source, point.sourceOffset)
  return tail !== undefined && marked(tail)
}

function markupPrecedes(source: string, point: number) {
  const windowStart = Math.max(0, point - 8_192)
  const window = source.slice(windowStart, point)
  const lastText = window.lastIndexOf('</w:t>')
  const tail =
    lastText === -1 ? window : window.slice(lastText + '</w:t>'.length)
  return /<w:t[\s>]/u.test(tail) ? undefined : tail
}
