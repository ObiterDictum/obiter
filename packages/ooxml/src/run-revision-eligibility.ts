import type { TextRunAnchor } from './model'

/**
 * A run is splittable when its inner content is covered by its `w:t` elements
 * and an optional single leading `w:rPr` — anything else (a tab, a break, a
 * field character, an instruction, a reference, a drawing, a range marker, a
 * comment, even a stray element boundary) leaves a non-whitespace gap and
 * fails closed to the whole-run form. The anchor's own ranges answer this
 * without re-parsing: every `w:t` the parser anchored is a direct child of a
 * splittable run by construction.
 */
export function isSplittableRun(source: string, anchor: TextRunAnchor) {
  if (anchor.runProperties.length > 1) return false
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
    if (child.start < cursor || child.end > inner.end) return false
    if (!/^\s*$/u.test(source.slice(cursor, child.start))) return false
    cursor = child.end
  }
  if (!/^\s*$/u.test(source.slice(cursor, inner.end))) return false
  const properties = anchor.runPropertiesRange
  // The properties element leads the run; anything else is malformed markup
  // the split does not pretend to understand.
  if (properties && children[0]?.start !== properties.start) return false
  return true
}
