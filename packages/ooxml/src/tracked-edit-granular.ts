import type { TextRunAnchor } from './model'
import {
  textElementXmlSpaceAttribute,
  wordRunInnerTextXml,
} from './text-run-edit'
import { escapeXmlText } from './parts/overlay'

/**
 * The granular tracked text replacement. The tracked-change writer in
 * tracked-edits.ts decides between this shape and the whole-run form; this
 * module only measures the changed middle and proves whether the run can be
 * split at it. Every function here is pure: it takes source XML and anchors,
 * and returns XML.
 */

export type GranularRunEdit =
  | {
      kind: 'pieces'
      prefixRun?: string
      deletedRun?: string
      insertedRun?: string
      suffixRun?: string
    }
  | { kind: 'noop' }
  | { kind: 'fallback' }

/**
 * The granular form of a tracked text replacement. The run splits at the
 * changed middle: an untouched run for the shared head, a `w:del` run holding
 * only the removed characters, a `w:ins` run holding only the inserted ones
 * and an untouched run for the shared tail — the shape Word itself writes,
 * and the shape legal review expects.
 *
 * Only a run whose content is safely splittable qualifies: an optional
 * `w:rPr` plus plain `w:t` children and no text-wrapping breaks. A run
 * carrying tabs, breaks, field characters, instructions, note or comment
 * references, drawings, bookmark or comment range markers, or any other
 * child falls back to the whole-run form — fail closed, because those
 * children carry identity or structure a blind split would duplicate.
 */
export function granularRunEdit(
  source: string,
  anchor: TextRunAnchor,
  text: string,
  prefix: string,
): GranularRunEdit {
  if (anchor.textBreaks.length > 0) return { kind: 'fallback' }
  const run = splittableRunParts(source, anchor)
  if (!run) return { kind: 'fallback' }
  const middle = trackedTextMiddle(anchor.wire.text, text)
  if (!middle) return { kind: 'fallback' }
  const { removed, inserted } = middle
  if (removed === '' && inserted === '') return { kind: 'noop' }

  const runClose = `</${prefix}:r>`
  const rpr = run.rpr ?? ''
  const unchangedRun = (piece: string) =>
    `${run.open}${rpr}<${prefix}:t${textElementXmlSpaceAttribute(piece)}>${escapeXmlText(piece)}</${prefix}:t>${runClose}`
  const pieces: Extract<GranularRunEdit, { kind: 'pieces' }> = {
    kind: 'pieces',
  }
  if (middle.prefixLength > 0) {
    pieces.prefixRun = unchangedRun(
      anchor.wire.text.slice(0, middle.prefixLength),
    )
  }
  if (middle.suffixLength > 0) {
    pieces.suffixRun = unchangedRun(
      anchor.wire.text.slice(anchor.wire.text.length - middle.suffixLength),
    )
  }
  if (removed !== '') {
    pieces.deletedRun = `${run.open}${rpr}<${prefix}:delText${textElementXmlSpaceAttribute(removed)}>${escapeXmlText(removed)}</${prefix}:delText>${runClose}`
  }
  if (inserted !== '') {
    pieces.insertedRun = `${run.open}${rpr}${wordRunInnerTextXml(prefix, inserted)}${runClose}`
  }
  return pieces
}

/**
 * The changed middle between a run's old text and its replacement: the
 * longest shared head and tail, never splitting a UTF-16 surrogate pair.
 * Returns undefined when the kept head or tail would not read identically on
 * both sides — the caller then falls back to the whole-run form.
 *
 * A substitution (both sides non-empty) snaps outward to whitespace-delimited
 * token boundaries: a reviewer reads the struck token against its replacement
 * — `60,000` for `50,000` — where a mid-token fragment (`6` for `5`) leaves
 * the changed quantity ambiguous. Insertions and deletions stay
 * character-minimal, which is what typing itself produces.
 */
export function trackedTextMiddle(from: string, to: string) {
  const max = Math.min(from.length, to.length)
  let prefixLength = 0
  while (prefixLength < max && from[prefixLength] === to[prefixLength]) {
    prefixLength += 1
  }
  if (pairBoundary(from, prefixLength) || pairBoundary(to, prefixLength)) {
    prefixLength -= 1
  }
  let suffixLength = 0
  const suffixMax = Math.min(from.length, to.length) - prefixLength
  while (
    suffixLength < suffixMax &&
    from[from.length - 1 - suffixLength] === to[to.length - 1 - suffixLength]
  ) {
    suffixLength += 1
  }
  if (
    pairBoundary(from, from.length - suffixLength) ||
    pairBoundary(to, to.length - suffixLength)
  ) {
    suffixLength -= 1
  }
  let start = prefixLength
  let oldEnd = from.length - suffixLength
  let newEnd = to.length - suffixLength
  if (from.slice(start, oldEnd) !== '' && to.slice(start, newEnd) !== '') {
    // Both expansions walk the identical shared head and tail, so the kept
    // edges stay equal on both sides by construction; the check below proves
    // it rather than assuming it.
    while (start > 0 && !isWordWhitespace(from[start - 1]!)) start -= 1
    while (oldEnd < from.length && !isWordWhitespace(from[oldEnd]!)) {
      oldEnd += 1
    }
    while (newEnd < to.length && !isWordWhitespace(to[newEnd]!)) newEnd += 1
  }
  if (from.slice(0, start) !== to.slice(0, start)) return undefined
  if (from.slice(oldEnd) !== to.slice(newEnd)) return undefined
  return {
    prefixLength: start,
    removed: from.slice(start, oldEnd),
    inserted: to.slice(start, newEnd),
    suffixLength: from.length - oldEnd,
  }
}

/**
 * A run is splittable when its inner content is covered by its `w:t` elements
 * and an optional single leading `w:rPr` — anything else (a tab, a break, a
 * field character, an instruction, a reference, a drawing, a range marker, a
 * comment, even a stray element boundary) leaves a non-whitespace gap and
 * fails closed to the whole-run form. The anchor's own ranges answer this
 * without re-parsing: every `w:t` the parser anchored is a direct child of a
 * splittable run by construction.
 */
function splittableRunParts(source: string, anchor: TextRunAnchor) {
  if (anchor.runProperties.length > 1) return undefined
  const children = [
    ...(anchor.runPropertiesRange ? [anchor.runPropertiesRange] : []),
    ...anchor.textElements,
  ].sort((left, right) => left.start - right.start)
  const inner = {
    start: anchor.runRange.startTagEnd,
    end: anchor.runRange.endTagStart,
  }
  let cursor = inner.start
  for (const child of children) {
    if (child.start < cursor || child.end > inner.end) return undefined
    if (!/^\s*$/u.test(source.slice(cursor, child.start))) return undefined
    cursor = child.end
  }
  if (!/^\s*$/u.test(source.slice(cursor, inner.end))) return undefined
  const properties = anchor.runPropertiesRange
  // The properties element leads the run; anything else is malformed markup
  // the split does not pretend to understand.
  if (properties && children[0]?.start !== properties.start) return undefined
  return {
    open: source.slice(anchor.runRange.start, anchor.runRange.startTagEnd),
    rpr: properties
      ? source.slice(properties.start, properties.end)
      : undefined,
  }
}

function pairBoundary(text: string, at: number) {
  if (at <= 0 || at >= text.length) return false
  const lead = text.charCodeAt(at - 1)
  const tail = text.charCodeAt(at)
  return lead >= 0xd800 && lead <= 0xdbff && tail >= 0xdc00 && tail <= 0xdfff
}

/** XML whitespace: the four characters Word's own tokenisation treats as a
 * break. Non-breaking spaces stay inside a token so a struck quantity keeps
 * its unit. */
function isWordWhitespace(char: string) {
  return char === ' ' || char === '\t' || char === '\n' || char === '\r'
}
