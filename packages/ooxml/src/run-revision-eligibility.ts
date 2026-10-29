import type { TextRunAnchor } from './model'

export function hasPropertyRevision(fragments: readonly string[]) {
  return fragments.some((fragment) =>
    /<(?:[^:<>\s]+:)?rPrChange[\s/>]/u.test(fragment),
  )
}

export function hasSplittableProperties(runProperties: readonly string[]) {
  return runProperties.length <= 1 && !hasPropertyRevision(runProperties)
}

export function isSplittableRun(
  source: string,
  anchor: Pick<
    TextRunAnchor,
    'runRange' | 'runProperties' | 'runPropertiesRange' | 'textElements'
  >,
) {
  if (!hasSplittableProperties(anchor.runProperties)) return false
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
  if (properties && children[0]?.start !== properties.start) return false
  return true
}
