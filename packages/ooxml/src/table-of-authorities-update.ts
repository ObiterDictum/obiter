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
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  elementFragment,
  escapeXmlText,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import {
  attributeValue,
  isWord,
  WORD_NAMESPACE,
  type XmlElement,
} from './parts/xml-elements'
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
const FIELD_BEGIN = /<w:fldChar\b[^>]*\bw:fldCharType="begin"/u
const FIELD_SEPARATE = /<w:fldChar\b[^>]*\bw:fldCharType="separate"/u
const TOA_INSTRUCTION = /<w:instrText\b[^>]*>[^<]*\bTOA\b/u

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
  const parent = headElement?.parent
  if (!headElement || !isWord(headElement, 'p') || !parent) {
    throw new OoxmlError('invalid-document-edit')
  }
  const headFragment = elementFragment(source, headElement)
  if (
    !FIELD_BEGIN.test(headFragment) ||
    !TOA_INSTRUCTION.test(headFragment) ||
    !FIELD_SEPARATE.test(headFragment)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }

  // Walk the source for the field's own `end`: sibling `w:p` elements
  // count their `fldChar` begins and ends, so a nested `PAGEREF` or `TA`
  // field balances inside a paragraph while the field's `end` drops the
  // depth to zero. A table or section boundary reached mid-field, or a
  // field that never closes, is malformed rather than a bigger range.
  let depth = 0
  let endElement: XmlElement | undefined
  let endFieldChar: XmlElement | undefined
  let currentParagraph: XmlElement | undefined
  for (const element of elements) {
    if (element.start < headElement.start) continue
    if (isWord(element, 'p') && element.parent === parent) {
      if (depth === 0 && element !== headElement) break
      currentParagraph = element
      continue
    }
    if (depth > 0 && element.parent === parent) {
      throw new OoxmlError('invalid-document-edit')
    }
    if (!isWord(element, 'fldChar') || currentParagraph === undefined) {
      continue
    }
    const type = attributeValue(element, WORD_NAMESPACE, 'fldCharType')
    if (type === 'begin') depth += 1
    else if (type === 'end') {
      depth -= 1
      if (depth <= 0) {
        endElement = currentParagraph
        endFieldChar = element
        break
      }
    }
  }
  if (!endElement || !endFieldChar || endElement === headElement) {
    throw new OoxmlError('invalid-document-edit')
  }
  // The kept tail must open with markup only: paragraph properties and
  // bookmarks, then the run holding the field's `end` — whose only other
  // content is its run properties. Text or unexpected markup ahead of the
  // `end` means the shape is not the generated one, so the field is not
  // safe to rewrite.
  const endRun = endFieldChar.parent
  if (!endRun || !isWord(endRun, 'r') || endRun.parent !== endElement) {
    throw new OoxmlError('invalid-document-edit')
  }
  if (
    !leadingMarkupOnly(source, elements, endElement, endRun, [
      'pPr',
      'bookmarkStart',
      'bookmarkEnd',
    ]) ||
    !leadingMarkupOnly(source, elements, endRun, endFieldChar, ['rPr'])
  ) {
    throw new OoxmlError('invalid-document-edit')
  }

  // The stored paragraphs the rewrite removes, and the batch's pending
  // replacements that would overlap the removed range. A paragraph-level
  // splice at either boundary still composes; anything strictly inside
  // does not.
  const removedIds = new Set<string>()
  for (const [id, anchor] of document.paragraphAnchors) {
    if (anchor.partName !== paragraph.partName) continue
    if (
      anchor.paragraphRange.start >= headElement.start &&
      anchor.paragraphRange.end <= endElement.start
    ) {
      removedIds.add(id)
      if (anchor.hasTrackedChanges) {
        throw new OoxmlError('model-node-not-editable')
      }
    }
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
 * The container's children before `bound` are only `allowed` elements
 * separated by whitespace — no text or unexpected markup — read from the
 * parsed element tree so Word's attribute order or an added `w:rPr`
 * cannot fool a regex.
 */
function leadingMarkupOnly(
  source: string,
  elements: readonly XmlElement[],
  container: XmlElement,
  bound: XmlElement,
  allowed: readonly string[],
) {
  let cursor = container.startTagEnd
  for (const element of elements) {
    if (element.parent !== container) continue
    if (element.start >= bound.start) break
    if (source.slice(cursor, element.start).trim().length > 0) return false
    if (!allowed.some((name) => isWord(element, name))) return false
    cursor = element.end
  }
  return source.slice(cursor, bound.start).trim().length === 0
}

/**
 * Whether the citation at `end` already carries its `TA` mark. A mark
 * written at an effective offset serialises immediately before the next
 * editable element — as sibling runs between the split halves, or inside
 * a run's pending replacement when the batch rewrote it — so the check
 * scans the markup that precedes the resolved point, never the text after
 * it. A mark for a different citation, or the same citation at a
 * different offset, does not match: the window ends at the last text
 * close before the point.
 */
function authorityMarkAt(
  overlay: XmlOverlay,
  anchor: ParagraphAnchor,
  offset: number,
  citation: string,
) {
  const instruction = ` TA \\l "${escapeXmlText(citation)}"`
  const holder = runHoldingOffset(anchor, offset)
  if (holder && runHasPendingOverlay(overlay, holder.run)) {
    const view = effectiveRunView(overlay, holder.run, anchor)
    const point = locateOffset(
      view.source,
      view.paragraph,
      offset - holder.runStart,
      true,
    )
    return markupPrecedes(view.source, point.sourceOffset, instruction)
  }
  const point = locateOffset(overlay.source, anchor, offset, true)
  // A mark this batch spliced at the same point is a zero-width insertion
  // sharing the resolved offset; a mark inside stored source sits between
  // the point and the last text element before it.
  for (const pending of overlay.replacements.values()) {
    if (
      pending.start === point.sourceOffset &&
      pending.value.includes(instruction)
    ) {
      return true
    }
  }
  return markupPrecedes(overlay.source, point.sourceOffset, instruction)
}

/**
 * The non-editable markup immediately before `point` — where a mark
 * written at that effective offset serialises — carries the instruction.
 * The window opens after the last `w:t` close, so content belonging to an
 * earlier position cannot answer for this one; a stray text open inside
 * the window means the point sits inside editable content, where no mark
 * can live.
 */
function markupPrecedes(source: string, point: number, instruction: string) {
  const windowStart = Math.max(0, point - 8_192)
  const window = source.slice(windowStart, point)
  const lastText = window.lastIndexOf('</w:t>')
  const tail =
    lastText === -1 ? window : window.slice(lastText + '</w:t>'.length)
  if (/<w:t[\s>]/u.test(tail)) return false
  return tail.includes(instruction)
}
