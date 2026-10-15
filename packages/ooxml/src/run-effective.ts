import type { ParagraphAnchor, TextRunAnchor, XmlElementRange } from './model'
import { OoxmlError } from './model'
import { mergeSiblingRuns, parseWrappedRun } from './model-run-range-edits'
import { elementFragment, type XmlOverlay } from './parts/overlay'
import { elementRange, isTextWrappingBreak } from './parts/xml-elements'
import { decodeXmlReferences } from './xml-lexemes'

/**
 * A run as it would serialise today: every pending overlay replacement inside
 * the run folded into a source string, so offsets resolve against the
 * effective text `wire.text` already describes. `consumedKeys` are the
 * replacements the fold absorbed — the caller removes them when it writes the
 * single replacement that supersedes them.
 */
export type EffectiveRunView = {
  source: string
  run: TextRunAnchor
  paragraph: ParagraphAnchor
  fragments: readonly string[]
  consumedKeys: readonly string[]
}

/**
 * Materialise a run whose content already lives in the overlay. A page-break
 * splice closes and reopens the run, so the folded XML can hold several
 * sibling `<w:r>` elements for what the model still treats as one run; they
 * are coalesced into a single run — one property set — so callers see exactly
 * the characters `wire.text` holds.
 */
export function effectiveRunView(
  overlay: XmlOverlay,
  run: TextRunAnchor,
  paragraph: ParagraphAnchor,
): EffectiveRunView {
  const folded = materialiseRun(overlay, run)
  const source = mergeSiblingRuns(overlay.source, folded.xml)
  const elements = parseWrappedRun(overlay.source, source)
  const runElements = elements.filter((element) => element.depth === 0)
  const first = runElements[0]
  const last = runElements.at(-1)
  if (!first || !last || runElements.length !== 1) {
    throw new OoxmlError('invalid-document-edit')
  }
  const children = elements.filter((element) => element.depth === 1)
  const textElements = children
    .filter((element) => element.localName === 't' && !element.selfClosing)
    .map(elementRange)
  const textBreaks = children
    .filter((element) => isTextWrappingBreak(element))
    .map(elementRange)
  // Mirror the parser: a w:br contributes one text character only when it is
  // a text-wrapping break. A page or column break is structure and consumes
  // none.
  let effectiveText = ''
  for (const element of children) {
    if (element.localName === 't' && !element.selfClosing) {
      effectiveText += decodeXmlReferences(
        source.slice(element.startTagEnd, element.endTagStart),
      )
    } else if (isTextWrappingBreak(element)) {
      effectiveText += '\n'
    }
  }
  if (effectiveText !== run.wire.text) {
    throw new OoxmlError('invalid-document-edit')
  }
  const fragments = children
    .filter(
      (element) => element.localName !== 't' && !isTextWrappingBreak(element),
    )
    .map((element) => elementFragment(source, element))
  const runRange: XmlElementRange = {
    start: first.start,
    startTagEnd: first.startTagEnd,
    endTagStart: last.endTagStart,
    end: last.end,
  }
  const effectiveRun: TextRunAnchor = {
    partName: run.partName,
    wire: run.wire,
    runRange,
    textRanges: textElements.map(({ startTagEnd, endTagStart }) => ({
      start: startTagEnd,
      end: endTagStart,
    })),
    textElements,
    textBreaks,
    runProperties: fragments.filter((fragment) => /<w:rPr\b/u.test(fragment)),
  }
  return {
    source,
    run: effectiveRun,
    paragraph: {
      ...paragraph,
      runs: [effectiveRun],
      paragraphRange: runRange,
    },
    fragments,
    consumedKeys: folded.keys,
  }
}

/**
 * Fold every overlay replacement inside the run into its source slice, so the
 * returned XML is the run exactly as it would serialise today. Callers then
 * write a single replacement covering the run, which cannot overlap the
 * folded ones. The consumed keys come back with the fold so the caller
 * removes them only once its own write is planned.
 */
export function materialiseRun(overlay: XmlOverlay, run: TextRunAnchor) {
  const { start, end } = run.runRange
  const replacements = [...overlay.replacements.entries()]
    .filter(([, replacement]) => insideRunRange(replacement, start, end))
    .sort((left, right) => left[1].start - right[1].start)
  let cursor = start
  let result = ''
  const keys: string[] = []
  for (const [key, replacement] of replacements) {
    if (replacement.start < cursor) {
      throw new OoxmlError('invalid-document-edit')
    }
    result += overlay.source.slice(cursor, replacement.start)
    result += replacement.value
    cursor = replacement.end
    keys.push(key)
  }
  result += overlay.source.slice(cursor, end)
  return { xml: result, keys }
}

/**
 * Whether the run's text or structure already lives in the overlay. Any
 * replacement whose range sits inside the run — a run-keyed text or property
 * write, or a paragraph-keyed page-break splice — means the run's source no
 * longer maps to its model text, so an edit addressing effective text must
 * materialise the run rather than locate a source offset. A zero-width
 * insertion exactly at the run's end belongs to the following boundary (the
 * next run's start, or the paragraph end), not to this run.
 */
export function runHasPendingOverlay(overlay: XmlOverlay, run: TextRunAnchor) {
  const { start, end } = run.runRange
  for (const [key, replacement] of overlay.replacements) {
    if (key.startsWith(`${run.wire.id}:`)) return true
    if (insideRunRange(replacement, start, end) && replacement.start < end) {
      return true
    }
  }
  return false
}

/**
 * Whether a pending replacement's range lands inside the run's source. A
 * zero-width insertion exactly at either boundary — a paragraph-level
 * bookmark marker or splice point — sits before or after the element rather
 * than inside it, so it neither marks the run rewritten nor folds into its
 * materialised XML.
 */
function insideRunRange(
  replacement: { start: number; end: number },
  start: number,
  end: number,
) {
  if (
    replacement.start === replacement.end &&
    (replacement.start === start || replacement.start === end)
  ) {
    return false
  }
  return replacement.start >= start && replacement.end <= end
}
