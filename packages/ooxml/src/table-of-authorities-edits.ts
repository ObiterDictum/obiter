import {
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_ENTRIES,
  DOCUMENT_EDIT_TABLE_OF_AUTHORITIES_MAX_OCCURRENCES,
} from '@obiter/contracts'
import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset } from './text-offsets'
import { ensureParagraphBookmark } from './document-bookmarks'
import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { runHasPendingOverlay } from './run-effective'
import {
  assertNoPendingAt,
  runHoldingOffset,
  spliceInlineXml,
  spliceIntoPendingRun,
  spliceRunWires,
  validateEffectiveOffset,
} from './structure-splice'
import { nextSyntheticParaId } from './structure-package'
import { W14_NAMESPACE } from './structure-xml'
import { tableOfAuthoritiesCitations } from './table-of-authorities-entries'
import {
  effectivePropertiesXml,
  isBlankParagraph,
  spliceIntoBlankParagraph,
  spliceParagraphWires,
  tocSpliceReplacement,
} from './table-of-contents-splice'
import {
  sectionColumnWidthTwips,
  TOC_FIELD_END_RUN,
} from './table-of-contents-xml'
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
 * Splices a multi-paragraph `TOA` field at `offset` in `paragraph` — the
 * same generated-structure shape a table of contents takes:
 *
 * ```
 * <w:p>…head…</w:p>
 * <w:p>begin instrText(TOA) separate Table of Cases</w:p>
 * <w:p>entry …PAGEREF…</w:p>
 * <w:p><w:r><w:fldChar end/></w:r>…tail…</w:p>
 * ```
 *
 * The entries are the body's distinct neutral citations, captured when the
 * batch applies — a stored snapshot, never recomputed. Before the field is
 * written the body is marked up like Word's mark-all gesture: a hidden `TA`
 * field after every citation occurrence and a `_ToA<n>` bookmark around
 * every citing paragraph, which the entries' `PAGEREF` fields resolve.
 *
 * Refusals mirror the structural writers: the anchor must be a direct body
 * child without `w:sectPr` and free of tracked changes; a citing paragraph
 * carrying tracked changes cannot hold a mark or a bookmark, so the whole
 * insertion fails closed; a mark or field splice inside a stored
 * `w:hyperlink` is refused rather than nested; and a document with no
 * citation to list, or more than the contract's entry or occurrence
 * ceilings, is refused rather than written empty or unbounded.
 *
 * Returns the tail wire and the number of paragraph wires the splice
 * appended after the anchor — heading, entries and tail — so the
 * dispatcher's post-anchor bookkeeping stays in step with the serialised
 * order.
 */
export function insertTableOfAuthorities(
  document: OoxmlDocument,
  story: DocumentStoryWire,
  paragraph: ParagraphAnchor,
  offset: number,
  occurrence: number,
  deletedIds: ReadonlySet<string>,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const part = requireEditablePart(document, paragraph.partName)
  if (paragraph.hasTrackedChanges) {
    throw new OoxmlError('model-node-not-editable')
  }
  validateEffectiveOffset(paragraph, offset)
  const source = part.overlay.source
  const elements = parseXmlElements(source)
  const paragraphElement = elements.find(
    (element) => element.start === paragraph.paragraphRange.start,
  )
  const parent = paragraphElement?.parent
  if (!paragraphElement || !parent || !isWord(parent, 'body')) {
    throw new OoxmlError('invalid-document-edit')
  }

  const { occurrences, entries } = tableOfAuthoritiesCitations(story.paragraphs)
  // The citations a field written now can bind: a citing paragraph deleted
  // later in the batch is gone, and one the same batch inserted exists only
  // as pending XML — it cannot carry a stored bookmark or mark, so it drops
  // out of the list rather than dangling. A citing paragraph with tracked
  // changes cannot hold either safely, so the insertion refuses.
  const anchors = new Map<string, ParagraphAnchor>()
  for (const id of new Set([
    ...entries.flatMap((entry) => entry.paragraphIds),
    ...occurrences.map((hit) => hit.paragraphId),
  ])) {
    if (deletedIds.has(id)) continue
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

  // The field splice's own refusals come before any markup is written:
  // a section-ending anchor cannot split and the splice point cannot sit
  // inside a stored `w:hyperlink` or a pending replacement — checked now
  // so a refused field cannot leave a half-marked document behind.
  const overlay = part.overlay
  const pPrCopy = effectivePropertiesXml(overlay, paragraph)
  if (/<w:sectPr\b/u.test(pPrCopy)) {
    throw new OoxmlError('invalid-document-edit')
  }
  const holder = runHoldingOffset(paragraph, offset)
  if (holder && runHasPendingOverlay(overlay, holder.run)) {
    refuseInsideStoredHyperlink(overlay, holder.run.runRange.start)
    if (holder.run.wire.hyperlinkTarget !== undefined) {
      throw new OoxmlError('invalid-document-edit')
    }
  } else if (!isBlankParagraph(paragraph)) {
    const point = locateOffset(source, paragraph, offset, true)
    assertNoPendingAt(overlay, point.sourceOffset)
    refuseInsideStoredHyperlink(overlay, point.sourceOffset)
  }

  // Marks first: zero-width splices never move a later offset, and each
  // citing run's wire splits exactly as the source splice splits the
  // element.
  const nextRunId = () => allocateModelId(document, 'text-edit')
  liveOccurrences.forEach((hit, index) => {
    const anchor = anchors.get(hit.paragraphId)
    if (!anchor) return
    spliceInlineXml(
      part.overlay,
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
  const tailParaId = nextSyntheticParaId(overlay)
  const tabPosition = sectionColumnWidthTwips(
    elements,
    paragraph.paragraphRange.end,
  )
  const entriesXml =
    toaHeadingParagraphXml(headingParaId) +
    toaEntries
      .map((entry, index) =>
        toaEntryParagraphXml(entry, paraIds[index] ?? '', tabPosition),
      )
      .join('')
  const tailOpen = `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${tailParaId}">${pPrCopy}${TOC_FIELD_END_RUN}`

  if (isBlankParagraph(paragraph)) {
    spliceIntoBlankParagraph(
      overlay,
      paragraph,
      entriesXml,
      tailParaId,
      pPrCopy,
    )
  } else {
    const insertion = `</w:p>${entriesXml}${tailOpen}`
    const key = `${paragraph.wire.id}:toa:${String(occurrence)}`
    const holder = runHoldingOffset(paragraph, offset)
    if (holder && runHasPendingOverlay(overlay, holder.run)) {
      refuseInsideStoredHyperlink(overlay, holder.run.runRange.start)
      if (holder.run.wire.hyperlinkTarget !== undefined) {
        throw new OoxmlError('invalid-document-edit')
      }
      spliceIntoPendingRun(overlay, paragraph, holder, offset, insertion, key)
    } else {
      const point = locateOffset(source, paragraph, offset, true)
      assertNoPendingAt(overlay, point.sourceOffset)
      refuseInsideStoredHyperlink(overlay, point.sourceOffset)
      setOverlayReplacement(
        overlay,
        key,
        tocSpliceReplacement(source, point, insertion),
      )
    }
  }
  part.dirty = true

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
  const tailWire = spliceParagraphWires(
    document,
    story,
    paragraph,
    offset,
    insertedWires,
    tailParaId,
    pPrCopy,
    lineage,
  )
  return { lastWire: tailWire, appended: toaEntries.length + 2 }
}

/**
 * A splice inside a stored `w:hyperlink` would nest the field inside the
 * link; the same half-open rule `spliceInlineXml` applies.
 */
function refuseInsideStoredHyperlink(
  overlay: XmlOverlay,
  sourceOffset: number,
) {
  for (const element of parseXmlElements(overlay.source)) {
    if (
      isWord(element, 'hyperlink') &&
      element.start < sourceOffset &&
      sourceOffset < element.end
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}
