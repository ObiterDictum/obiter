import { sliceRunRevisionMetadata } from './run-revision-slice'
import type {
  DocumentParagraphWire,
  DocumentTextRunWire,
} from '@obiter/contracts'

import {
  locateOffset,
  preserveTextOpeningTag,
  type InsertionPoint,
} from './text-offsets'
import { recordSplitRun, type LineageRecorder } from './document-lineage'
import { OoxmlError, type ParagraphAnchor, type TextRunAnchor } from './model'
import { splitsSurrogate } from './model-run-range-edits'
import { isBlankParagraph } from './table-of-contents-splice'
import {
  applyFragmentReplacements,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { effectiveRunView, runHasPendingOverlay } from './run-effective'

export function spliceInlineXml(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  offset: number,
  xml: string,
  key: string,
) {
  validateEffectiveOffset(paragraph, offset)
  if (isBlankParagraph(paragraph)) {
    spliceIntoBlankParagraph(overlay, paragraph, xml)
    return
  }
  const holder = runHoldingOffset(paragraph, offset)
  if (holder && runHasPendingOverlay(overlay, holder.run)) {
    refuseInsideStoredHyperlink(overlay, holder.run.runRange.start)
    if (holder.run.wire.hyperlinkTarget !== undefined) {
      throw new OoxmlError('invalid-document-edit')
    }
    spliceIntoPendingRun(overlay, paragraph, holder, offset, xml, key)
    return
  }
  const point = locateOffset(overlay.source, paragraph, offset, true)
  assertNoPendingAt(overlay, point.sourceOffset)
  refuseInsideStoredHyperlink(overlay, point.sourceOffset)
  setOverlayReplacement(
    overlay,
    key,
    spliceReplacement(overlay.source, point, xml),
  )
}

export function runHoldingOffset(paragraph: ParagraphAnchor, offset: number) {
  let runStart = 0
  for (const run of paragraph.runs) {
    const runEnd = runStart + run.wire.text.length
    if (offset > runStart && offset < runEnd) return { run, runStart }
    runStart = runEnd
  }
  return undefined
}

export function spliceIntoPendingRun(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  holder: { run: TextRunAnchor; runStart: number },
  offset: number,
  xml: string,
  key: string,
) {
  const { run, runStart } = holder
  const view = effectiveRunView(overlay, run, paragraph)
  const point = locateOffset(
    view.source,
    view.paragraph,
    offset - runStart,
    true,
  )
  const serialised = applyFragmentReplacements(view.source, [
    spliceReplacement(view.source, point, xml),
  ])
  if (serialised === undefined) throw new OoxmlError('invalid-document-edit')
  const consumed = new Set(view.consumedKeys)
  for (const [pendingKey, pending] of overlay.replacements) {
    if (
      !consumed.has(pendingKey) &&
      pending.start < run.runRange.end &&
      pending.end > run.runRange.start
    ) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
  for (const pendingKey of consumed) {
    overlay.replacements.delete(pendingKey)
  }
  setOverlayReplacement(overlay, key, {
    start: run.runRange.start,
    end: run.runRange.end,
    value: serialised,
  })
  run.wire.preservedXmlFragments = [...view.fragments]
}

export function validateEffectiveOffset(
  paragraph: ParagraphAnchor,
  offset: number,
) {
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  if (offset > text.length || splitsSurrogate(text, offset)) {
    throw new OoxmlError('invalid-document-edit')
  }
}

export function assertNoPendingAt(overlay: XmlOverlay, sourceOffset: number) {
  for (const pending of overlay.replacements.values()) {
    if (pending.start < sourceOffset && sourceOffset < pending.end) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

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

function spliceIntoBlankParagraph(
  overlay: XmlOverlay,
  paragraph: ParagraphAnchor,
  xml: string,
) {
  const range = paragraph.paragraphRange
  const key = `${paragraph.wire.id}:pPr`
  const existing = overlay.replacements.get(key)
  const opening = overlay.source
    .slice(range.start, range.startTagEnd)
    .replace(/\/\s*>$/u, '>')
  if (existing && /^<w:pPr\b/u.test(existing.value)) {
    setOverlayReplacement(overlay, key, {
      start: range.start,
      end: range.end,
      value: `${opening}${existing.value}${xml}</w:p>`,
    })
    return
  }
  if (existing && /^<w:p\b/u.test(existing.value)) {
    setOverlayReplacement(overlay, key, {
      ...existing,
      value: existing.value.replace(/<\/w:p>$/u, `${xml}</w:p>`),
    })
    return
  }
  setOverlayReplacement(overlay, key, {
    start: range.start,
    end: range.end,
    value: `${opening}${xml}</w:p>`,
  })
}

function spliceReplacement(source: string, point: InsertionPoint, xml: string) {
  const split = point.split
  if (!split) {
    return {
      start: point.sourceOffset,
      end: point.sourceOffset,
      value: xml,
    }
  }
  if (split.kind !== 'run') {
    throw new OoxmlError('invalid-document-edit')
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
      value: `${closeText}${closeRun}${xml}${openRun}${properties}${openText}`,
    }
  }
  return {
    start: point.sourceOffset,
    end: point.sourceOffset,
    value: `${closeRun}${xml}${openRun}${properties}`,
  }
}

export function spliceRunWires(
  wire: DocumentParagraphWire,
  offset: number,
  inserted: readonly DocumentTextRunWire[],
  nextId: () => string,
  lineage?: LineageRecorder,
) {
  const runs = wire.runs
  let cursor = 0
  for (let index = 0; index < runs.length; index += 1) {
    const run = runs[index]
    if (!run) break
    if (run.text.length === 0) continue
    const end = cursor + run.text.length
    if (offset === cursor) {
      runs.splice(index, 0, ...inserted)
      return
    }
    if (offset < end) {
      const head: DocumentTextRunWire = {
        ...run,
        ...sliceRunRevisionMetadata(run, 0, offset - cursor),
        text: run.text.slice(0, offset - cursor),
      }
      const tail: DocumentTextRunWire = {
        ...run,
        id: nextId(),
        ...sliceRunRevisionMetadata(run, offset - cursor, run.text.length),
        text: run.text.slice(offset - cursor),
        preservedXmlFragments: run.preservedXmlFragments.filter((fragment) =>
          /^<w:rPr\b/u.test(fragment),
        ),
      }
      runs.splice(index, 1, head, ...inserted, tail)
      if (lineage) {
        recordSplitRun(lineage, run, [
          { run: head, from: 0, to: offset - cursor },
          { run: tail, from: offset - cursor, to: end - cursor },
        ])
      }
      return
    }
    cursor = end
  }
  runs.push(...inserted)
}
