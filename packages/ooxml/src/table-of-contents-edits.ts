import { DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES } from '@obiter/contracts'
import type { DocumentStoryWire } from '@obiter/contracts'

import { locateOffset } from './text-offsets'
import { ensureParagraphBookmark } from './document-bookmarks'
import type { LineageRecorder } from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { nextSyntheticParaId } from './structure-package'
import { W14_NAMESPACE } from './structure-xml'
import { runHasPendingOverlay } from './run-effective'
import {
  assertNoPendingAt,
  runHoldingOffset,
  spliceIntoPendingRun,
  validateEffectiveOffset,
} from './structure-splice'
import { tableOfContentsEntries } from './table-of-contents-entries'
import {
  effectivePropertiesXml,
  isBlankParagraph,
  spliceIntoBlankParagraph,
  spliceParagraphWires,
  tocSpliceReplacement,
} from './table-of-contents-splice'
import {
  entryParagraphXml,
  sectionColumnWidthTwips,
  TOC_FIELD_END_RUN,
  type TocEntry,
} from './table-of-contents-xml'

const TOC_BOOKMARK_PREFIX = '_Toc'

/**
 * Splices a multi-paragraph `TOC` field at `offset` in `paragraph` — the
 * first generated structure whose result is not run-level:
 *
 * ```
 * <w:p>…head…</w:p>
 * <w:p>begin instrText(TOC) separate entry 1 …PAGEREF…</w:p>
 * <w:p>entry 2 …</w:p>
 * <w:p><w:r><w:fldChar end/></w:r>…tail…</w:p>
 * ```
 *
 * The head paragraph closes at the caret and the tail reopens after the
 * entry paragraphs — the shape a multi-paragraph field takes in OOXML:
 * `begin`, the instruction and `separate` sit inside the first result
 * paragraph, the remaining result paragraphs are siblings, and `end` opens
 * the paragraph the tail continues in. Every heading paragraph is
 * bookmarked `_Toc<n>` and each entry stores a `PAGEREF` field to it, so
 * the page reference resolves at paint like `PAGE` does.
 *
 * Entries are the document's heading paragraphs — by style and outline
 * level — computed when the batch applies: a stored snapshot, never
 * recomputed. A heading paragraph that already carries tracked changes
 * fails closed, like the other structural writers. An anchor that is not a
 * direct body child — a table cell, a content control — is refused, and so
 * is one whose `w:pPr` holds `w:sectPr`: those properties end a section at
 * the paragraph and the split would strand them on the head.
 *
 * Returns the tail wire and the number of paragraph wires the splice
 * appended after the anchor, so the dispatcher's post-anchor bookkeeping
 * stays in step with the serialised order.
 */
export function insertTableOfContents(
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
    // A table cell or a content-control paragraph is still part of the
    // document story, but entries that splice siblings beside it would
    // corrupt the container's child structure.
    throw new OoxmlError('invalid-document-edit')
  }

  const entries = headingEntries(document, deletedIds)
  if (
    entries.length === 0 ||
    entries.length > DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES
  ) {
    // A TOC with no entries stores an empty result field — the honest
    // answer is the refusal the ribbon already gives. Above the contract
    // ceiling the field would write unbounded generated paragraphs.
    throw new OoxmlError('invalid-document-edit')
  }

  const overlay = part.overlay
  const pPrCopy = effectivePropertiesXml(overlay, paragraph)
  if (/<w:sectPr\b/u.test(pPrCopy)) {
    throw new OoxmlError('invalid-document-edit')
  }
  const paraIds = entries.map(() => nextSyntheticParaId(overlay))
  const tailParaId = nextSyntheticParaId(overlay)
  const tabPosition = sectionColumnWidthTwips(
    elements,
    paragraph.paragraphRange.end,
  )
  const entriesXml = entries
    .map((entry, index) =>
      entryParagraphXml(entry, paraIds[index] ?? '', index === 0, tabPosition),
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
    const key = `${paragraph.wire.id}:toc:${String(occurrence)}`
    // The offset addresses effective text, and a run already rewritten in
    // this batch no longer maps to a source offset: compose into the
    // pending run replacement like every other splice, so the field lands
    // inside the text the batch wrote.
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

  const tailWire = spliceParagraphWires(
    document,
    story,
    paragraph,
    offset,
    entries,
    paraIds,
    tailParaId,
    pPrCopy,
    tabPosition,
    lineage,
  )
  return { lastWire: tailWire, appended: entries.length + 1 }
}

/**
 * The heading paragraphs the entry list is captured from: every document-
 * story paragraph the entry collector reports, mapped to its anchor and
 * bookmarked `_Toc<n>` — the bookmarks the entries' `PAGEREF` fields point
 * at. A paragraph the same batch inserted, or the tail an earlier same-batch
 * split created, exists only as pending XML and cannot carry a stored
 * bookmark yet, so it is skipped — the field lists the headings that were
 * stored. A heading with tracked changes cannot hold a bookmark safely, so
 * the whole insertion fails closed rather than drop it from the list. A
 * heading the same batch deletes is skipped too: bookmarking it would write
 * replacements inside the range its delete covers.
 */
function headingEntries(
  document: OoxmlDocument,
  deletedIds: ReadonlySet<string>,
): TocEntry[] {
  const entries: TocEntry[] = []
  for (const entry of tableOfContentsEntries(document.model)) {
    if (deletedIds.has(entry.paragraphId)) continue
    const anchor = document.paragraphAnchors.get(entry.paragraphId)
    if (!anchor) continue
    if (anchor.hasTrackedChanges) {
      throw new OoxmlError('model-node-not-editable')
    }
    entries.push({
      ...entry,
      bookmark: ensureParagraphBookmark(document, anchor, TOC_BOOKMARK_PREFIX),
    })
  }
  return entries
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
