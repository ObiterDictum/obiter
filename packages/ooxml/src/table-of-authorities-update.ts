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

/**
 * Regenerates a stored `TOA` field's result in place: the paragraphs from
 * the one holding the field's `begin`, instruction and `separate` up to —
 * not including — the one holding its `end` are replaced by a rebuilt
 * heading and entries over the body's current citations. The tail
 * paragraph survives, so whatever text follows the field's `end` is kept.
 *
 * The mark pass is idempotent: an occurrence already carrying a `TA`
 * field for its citation at the citation's end is left alone, so a
 * refresh does not accrete duplicate marks; the `_ToA` bookmark pass
 * reuses the names the last write placed. Anything that would make the
 * rewrite ambiguous fails closed — the head is not the field's first
 * three characters, the `end` never arrives, the tail holds real content
 * before the `end` run, the covered paragraphs carry tracked changes, a
 * pending replacement overlaps the removed range, or the citation set is
 * empty or over the contract ceilings.
 */
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

  // The stored field the anchor names: the scan pairs every field in the
  // part, so the `end` that follows is this field's own — a `PAGEREF`
  // balancing inside an entry, a `separate` an entry carries, and a field
  // nested inside a larger one all resolve the same way the model wire
  // recorded them. A stored `TOA` whose shape is not the generated one —
  // the `end` buried in an entry, wrapped in a content control, preceded
  // by content in its own paragraph — fails closed here, the same
  // contract the wire's `rangeReplaceable` records.
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

  // The stored paragraphs the rewrite removes — the span's range minus the
  // kept tail — and the batch's pending replacements that would overlap
  // them. A paragraph the span covers that never modelled — inside a
  // tracked wrapper or fallback the wire drops — cannot be accounted for,
  // so the rewrite refuses rather than erase markup it cannot see. A
  // paragraph-level splice at either boundary still composes; anything
  // strictly inside does not.
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

  // The citation set the rebuilt field lists, minus the paragraphs the
  // rewrite itself removes — a citation captured inside generated output
  // would mark a paragraph that no longer exists.
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

  // Marks first, exactly as the insertion writes them, except an
  // occurrence already marked for its citation is left alone: zero-width
  // splices never move a later offset, and deduplication is what makes a
  // refresh idempotent.
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

/**
 * Whether the citation at `end` already carries its `TA` mark. A mark
 * written at an effective offset serialises immediately before the next
 * editable element — as sibling runs between the split halves, or inside
 * a run's pending replacement when the batch rewrote it — so the check
 * scans the markup that precedes the resolved point, never the text after
 * it. Matching is on the parsed instruction, not the literal bytes: a
 * stored `TA` split across `instrText` runs, written with `&quot;`, or
 * carried by a `w:fldSimple` marks the citation exactly as the generated
 * literal does. A mark for a different citation, or the same citation at
 * a different offset, does not match: the window ends at the last text
 * close before the point.
 */
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
  // A mark this batch spliced at the same point is a zero-width insertion
  // sharing the resolved offset; a mark inside stored source sits between
  // the point and the last text element before it.
  for (const pending of overlay.replacements.values()) {
    if (pending.start === point.sourceOffset && marked(pending.value)) {
      return true
    }
  }
  const tail = markupPrecedes(overlay.source, point.sourceOffset)
  return tail !== undefined && marked(tail)
}

/**
 * The non-editable markup immediately before `point` — where a mark
 * written at that effective offset serialises — or `undefined` when the
 * point sits inside editable content a mark cannot share. The window
 * opens after the last `w:t` close, so content belonging to an earlier
 * position cannot answer for this one; a stray text open inside the
 * window means the point sits inside editable content, where no mark can
 * live.
 */
function markupPrecedes(source: string, point: number) {
  const windowStart = Math.max(0, point - 8_192)
  const window = source.slice(windowStart, point)
  const lastText = window.lastIndexOf('</w:t>')
  const tail =
    lastText === -1 ? window : window.slice(lastText + '</w:t>'.length)
  return /<w:t[\s>]/u.test(tail) ? undefined : tail
}
