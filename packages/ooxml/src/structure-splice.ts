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
import {
  applyFragmentReplacements,
  parseXmlElements,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'
import { isWord } from './parts/xml-elements'
import { effectiveRunView, runHasPendingOverlay } from './run-effective'

/**
 * Splices paragraph-level or run-level content into a paragraph at an
 * effective-text offset: a picture run, a field, anything that is a sibling
 * of `w:r` under `w:p` or a `w:r` itself. When the offset sits inside a run
 * the run is closed and reopened around the content — the same splice
 * `insertPageBreak` performs, parameterised on the inserted markup.
 *
 * A splice that lands inside a pending replacement would corrupt the overlay,
 * so a run already rewritten in this batch refuses the edit rather than emit
 * overlapping ranges at serialise time. A splice strictly inside a stored
 * `w:hyperlink` is refused the same way: the content would nest inside the
 * element and its result text would silently join the link's anchor.
 */
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
  // The offset addresses effective text, and a run already rewritten in this
  // batch no longer maps to a source offset: compose into the pending run
  // replacement so the content lands inside the text the batch wrote.
  const holder = runHoldingOffset(paragraph, offset)
  if (holder && runHasPendingOverlay(overlay, holder.run)) {
    // A linked run's pending replacement still sits inside the `w:hyperlink`
    // element, so a splice into it would nest inside the link. The element
    // check catches a stored link — an internal `w:anchor` or a target the
    // parse allowlist dropped leaves nothing on the wire — and a run nested
    // in one always starts strictly inside it. The wire check is still what
    // catches a wrap written earlier in this batch: that element exists only
    // inside the pending replacement, not in `overlay.source`.
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

/** The run whose effective text strictly contains `offset`, if any. */
export function runHoldingOffset(paragraph: ParagraphAnchor, offset: number) {
  let runStart = 0
  for (const run of paragraph.runs) {
    const runEnd = runStart + run.wire.text.length
    if (offset > runStart && offset < runEnd) return { run, runStart }
    runStart = runEnd
  }
  return undefined
}

/**
 * Splices into a run that pending replacements already rewrote: fold them
 * into the run's effective XML, locate the offset in that text, and write one
 * whole-run replacement that supersedes the folded keys. Anything still
 * overlapping the run range afterwards cannot compose, so the edit refuses
 * rather than emit overlapping ranges at serialise time.
 */
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
}

/**
 * Validates an offset against the paragraph's effective text, the same rule
 * `insertPageBreak` applies: a same-batch text replacement has already updated
 * `wire.text`, so the address the client sent is resolved against the text the
 * document will hold.
 */
export function validateEffectiveOffset(
  paragraph: ParagraphAnchor,
  offset: number,
) {
  const text = paragraph.runs.map((run) => run.wire.text).join('')
  if (offset > text.length || splitsSurrogate(text, offset)) {
    throw new OoxmlError('invalid-document-edit')
  }
}

/** A pending replacement strictly containing the point cannot compose. */
export function assertNoPendingAt(overlay: XmlOverlay, sourceOffset: number) {
  for (const pending of overlay.replacements.values()) {
    if (pending.start < sourceOffset && sourceOffset < pending.end) {
      throw new OoxmlError('invalid-document-edit')
    }
  }
}

/**
 * A point inside a stored `w:hyperlink` element would nest the spliced field
 * or drawing inside the link. In effective-text terms the check is half-open
 * over the linked runs: the leading boundary opens the first linked run's
 * text element and refuses, while the trailing boundary lands at the next
 * element and composes — matching the client's half-open stored-link rule.
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

function isBlankParagraph(paragraph: ParagraphAnchor) {
  return (
    paragraph.runs.length === 0 &&
    paragraph.paragraphPropertiesRange === undefined
  )
}

/**
 * An empty paragraph has no run to split: the whole `w:p` element is replaced
 * with an open tag, the content and the close. The paragraph-owned `:pPr` key
 * is reused — as in `insertRunIntoEmptyParagraph` — so a property write in the
 * same batch keeps composing in schema order instead of racing the splice.
 */
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
  // A blank paragraph takes the whole-element splice path before this point,
  // so the only split that reaches here is a run split.
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

/**
 * Splices new run wires into a paragraph wire at an effective-text offset,
 * splitting the containing run into head/tail wires. The head keeps the
 * original id and fragments; the tail is a fresh id carrying only the run's
 * `w:rPr` fragments, matching what the source splice emits (the reopened tail
 * carries the same properties and no structural children). Wire-level
 * bookkeeping only — the on-disk splice is `spliceInlineXml`'s job. A
 * zero-length run at the offset stays before the splice so repeated inserts
 * order like their operations.
 */
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
    // A zero-length run consumes no offset; new inserts land after it so
    // repeated inserts at one offset keep their operation order.
    if (run.text.length === 0) continue
    const end = cursor + run.text.length
    if (offset === cursor) {
      runs.splice(index, 0, ...inserted)
      return
    }
    if (offset < end) {
      const head: DocumentTextRunWire = {
        ...run,
        text: run.text.slice(0, offset - cursor),
      }
      const tail: DocumentTextRunWire = {
        ...run,
        id: nextId(),
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
