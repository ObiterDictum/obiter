import { DOCUMENT_EDIT_TABLE_OF_CONTENTS_MAX_ENTRIES } from '@obiter/contracts'
import type {
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import {
  locateOffset,
  preserveTextOpeningTag,
  type InsertionPoint,
} from './comment-anchors'
import { ensureParagraphBookmark } from './document-bookmarks'
import {
  recordInsertedParagraph,
  recordSplitRun,
  seedRunOrigins,
  type LineageRecorder,
} from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { allocateModelId } from './model-paragraph-edits'
import {
  applyFragmentReplacements,
  parseXmlElements,
  setOverlayReplacement,
  type OverlayReplacement,
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
  entryParagraphWire,
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
 * The pPr the tail paragraph carries: the anchor's properties as they will
 * serialise — pending same-batch property writes folded in — since a
 * paragraph split keeps its formatting on both halves. A pending write that
 * overlaps the pPr range's boundary cannot be expressed, so the insertion
 * refuses rather than copy stale properties.
 */
function effectivePropertiesXml(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
) {
  const range = paragraph.paragraphPropertiesRange
  if (!range) {
    // A pending `:pPr` insert writes the whole new element at the start tag;
    // it is the paragraph's effective properties either way.
    const pending = overlay.replacements.get(`${paragraph.wire.id}:pPr`)
    if (pending && /^<w:pPr\b/u.test(pending.value)) return pending.value
    return ''
  }
  const inside: { start: number; end: number; value: string }[] = []
  for (const pending of overlay.replacements.values()) {
    if (pending.start >= range.start && pending.end <= range.end) {
      inside.push({
        start: pending.start - range.start,
        end: pending.end - range.start,
        value: pending.value,
      })
      continue
    }
    if (pending.start < range.end && pending.end > range.start) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  const merged = applyFragmentReplacements(
    overlay.source.slice(range.start, range.end),
    inside,
  )
  if (merged === undefined) throw new OoxmlError('invalid-document-edit')
  return merged
}

function isBlankParagraph(paragraph: ParagraphAnchor) {
  return (
    paragraph.runs.length === 0 &&
    paragraph.paragraphPropertiesRange === undefined
  )
}

/**
 * A blank paragraph has no run to split: the whole `w:p` element is replaced
 * with the closed head, the entries and the closed tail — the `:pPr`-keyed
 * merge this path uses, so a property write or an earlier zero-width field
 * splice into the same empty paragraph keeps composing in the same key
 * instead of racing this splice.
 */
function spliceIntoBlankParagraph(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  entriesXml: string,
  tailParaId: string,
  pPrCopy: string,
) {
  const range = paragraph.paragraphRange
  const key = `${paragraph.wire.id}:pPr`
  const existing = overlay.replacements.get(key)
  const tailXml = (pPr: string) =>
    `<w:p xmlns:w14="${W14_NAMESPACE}" w14:paraId="${tailParaId}">${pPr}${TOC_FIELD_END_RUN}</w:p>`
  if (existing && /^<w:p\b/u.test(existing.value)) {
    // The pending value is already a complete paragraph element (an earlier
    // field or property splice); the head it describes stays whole and the
    // entries follow it.
    const pPr =
      /<w:pPr\b[\s\S]*?<\/w:pPr>/u.exec(existing.value)?.[0] ?? pPrCopy
    setOverlayReplacement(overlay, key, {
      ...existing,
      value: `${existing.value}${entriesXml}${tailXml(pPr)}`,
    })
    return
  }
  for (const pending of overlay.replacements.values()) {
    if (pending === existing) continue
    if (pending.start < range.end && pending.end > range.start) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  const opening = overlay.source
    .slice(range.start, range.startTagEnd)
    .replace(/\/\s*>$/u, '>')
  const pPr =
    existing && /^<w:pPr\b/u.test(existing.value) ? existing.value : pPrCopy
  setOverlayReplacement(overlay, key, {
    start: range.start,
    end: range.end,
    value: `${opening}${pPr}</w:p>${entriesXml}${tailXml(pPr)}`,
  })
}

/**
 * The splice value at a located point: close whatever run/text the point
 * split, close the head paragraph, emit the entries, and open the tail —
 * carrying the copied pPr and the field `end` — before reopening the run
 * the tail text continues in. A point with no run to split inserts between
 * siblings instead.
 */
function tocSpliceReplacement(
  source: string,
  point: InsertionPoint,
  insertion: string,
): OverlayReplacement {
  const split = point.split
  if (!split) {
    return {
      start: point.sourceOffset,
      end: point.sourceOffset,
      value: insertion,
    }
  }
  if (split.kind === 'empty-paragraph') {
    const range = split.paragraph
    const opening = source
      .slice(range.start, range.startTagEnd)
      .replace(/\/\s*>$/u, '>')
    return {
      start: range.start,
      end: range.end,
      value: `${opening}</w:p>${insertion}`,
    }
  }
  const { run, textElement, position } = split
  const closeRun = source.slice(run.runRange.endTagStart, run.runRange.end)
  const openRun = source.slice(run.runRange.start, run.runRange.startTagEnd)
  const properties = run.runProperties.join('')
  if (position === 'content' && textElement) {
    const closeText = source.slice(textElement.endTagStart, textElement.end)
    const openText = preserveTextOpeningTag(
      source.slice(textElement.start, textElement.startTagEnd),
    )
    return {
      start: point.sourceOffset,
      end: point.sourceOffset,
      value: `${closeText}${closeRun}${insertion}${openRun}${properties}${openText}`,
    }
  }
  return {
    start: point.sourceOffset,
    end: point.sourceOffset,
    value: `${closeRun}${insertion}${openRun}${properties}`,
  }
}

/**
 * The wire counterpart of the source splice: the anchor's run list is split
 * at `offset`, the head runs stay on the anchor wire and the tail's — behind
 * the field `end` run — move to a new wire after the entry wires. The tail
 * keeps the paragraph's pPr fragment; other preserved children stay on the
 * head, which is where they serialise.
 */
function spliceParagraphWires(
  document: OoxmlDocument,
  story: DocumentStoryWire,
  paragraph: ParagraphAnchor,
  offset: number,
  entries: readonly TocEntry[],
  paraIds: readonly string[],
  tailParaId: string,
  pPrCopy: string,
  tabPosition: number,
  lineage?: { recorder: LineageRecorder; operationIndex: number },
) {
  const wire = paragraph.wire
  const nextRunId = () => allocateModelId(document, 'text-edit')
  const headRuns: DocumentTextRunWire[] = []
  const tailRuns: DocumentTextRunWire[] = []
  let cursor = 0
  let past = false
  for (const run of wire.runs) {
    if (past) {
      tailRuns.push(run)
      continue
    }
    if (run.text.length === 0) {
      headRuns.push(run)
      continue
    }
    const end = cursor + run.text.length
    if (offset >= end) {
      headRuns.push(run)
      cursor = end
      continue
    }
    if (offset <= cursor) {
      past = true
      tailRuns.push(run)
      continue
    }
    const head: DocumentTextRunWire = {
      ...run,
      text: run.text.slice(0, offset - cursor),
    }
    const tail: DocumentTextRunWire = {
      ...run,
      id: nextRunId(),
      text: run.text.slice(offset - cursor),
      preservedXmlFragments: run.preservedXmlFragments.filter((fragment) =>
        /^<w:rPr\b/u.test(fragment),
      ),
    }
    headRuns.push(head)
    tailRuns.push(tail)
    past = true
    if (lineage) {
      recordSplitRun(lineage.recorder, run, [
        { run: head, from: 0, to: offset - cursor },
        { run: tail, from: offset - cursor, to: end - cursor },
      ])
    }
  }
  wire.runs = headRuns

  const endRun: DocumentTextRunWire = {
    id: nextRunId(),
    text: '',
    preservedXmlFragments: ['<w:fldChar w:fldCharType="end"/>'],
  }
  const tailWire: DocumentParagraphWire = {
    id: `para-w14-${tailParaId}`,
    sourceParaId: tailParaId,
    ...(wire.styleId ? { styleId: wire.styleId } : {}),
    runs: [endRun, ...tailRuns],
    preservedXmlFragments: wire.preservedXmlFragments.filter((fragment) =>
      /^<w:pPr\b/u.test(fragment),
    ),
  }
  const entryWires = entries.map((entry, index) =>
    entryParagraphWire(
      nextRunId,
      entry,
      paraIds[index] ?? '',
      index === 0,
      tabPosition,
    ),
  )
  story.paragraphs.splice(
    story.paragraphs.indexOf(wire) + 1,
    0,
    ...entryWires,
    tailWire,
  )
  if (lineage) {
    for (const entry of entryWires) {
      recordInsertedParagraph(lineage.recorder, entry, lineage.operationIndex)
    }
    // The tail derives from the anchor rather than existing before — a
    // paragraph split — so its origin names the anchor, not null.
    lineage.recorder.touched.add(tailWire)
    lineage.recorder.paragraphOrigin.set(tailWire, {
      fromParagraphId: wire.id,
    })
    lineage.recorder.runOrigins.set(endRun, [
      { fromRunId: null, fromOffset: 0, toOffset: 0 },
    ])
    for (const run of tailWire.runs) {
      seedRunOrigins(lineage.recorder, run)
    }
  }
  return tailWire
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
