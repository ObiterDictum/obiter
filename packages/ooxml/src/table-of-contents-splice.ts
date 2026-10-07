import type {
  DocumentParagraphWire,
  DocumentStoryWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import { preserveTextOpeningTag, type InsertionPoint } from './comment-anchors'
import {
  recordInsertedParagraph,
  recordSplitRun,
  seedRunOrigins,
  type LineageRecorder,
} from './document-lineage'
import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { allocateModelId } from './model-paragraph-edits'
import {
  applyFragmentReplacements,
  setOverlayReplacement,
  type OverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { W14_NAMESPACE } from './structure-xml'
import {
  entryParagraphWire,
  TOC_FIELD_END_RUN,
  type TocEntry,
} from './table-of-contents-xml'

/**
 * The pPr the tail paragraph carries: the anchor's properties as they will
 * serialise — pending same-batch property writes folded in — since a
 * paragraph split keeps its formatting on both halves. A pending write that
 * overlaps the pPr range's boundary cannot be expressed, so the insertion
 * refuses rather than copy stale properties.
 */
export function effectivePropertiesXml(
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

export function isBlankParagraph(paragraph: ParagraphAnchor) {
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
export function spliceIntoBlankParagraph(
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
export function tocSpliceReplacement(
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
export function spliceParagraphWires(
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
