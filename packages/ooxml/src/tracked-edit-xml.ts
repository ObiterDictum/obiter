import {
  OoxmlError,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { expandSelfClosingProperties } from './model-properties'
import {
  applyFragmentReplacements,
  escapeXmlAttribute,
  escapeXmlText,
  renameFragmentElements,
} from './parts/overlay'
import {
  lineBreakRunReplacements,
  preserveTextElementXmlSpace,
  textBreakReplacements,
  textElementXmlSpaceAttribute,
  wordRunInnerTextXml,
} from './text-run-edit'

/**
 * XML fragments for tracked-change markers. The tracked-change writer in
 * tracked-edits.ts decides where a `w:ins`/`w:del`/`rPrChange`/`pPrChange`
 * wrapper goes; this module builds the fragment it splices in and the
 * insert-versus-delete pair every text replacement needs. Every function here
 * is pure: it takes source XML and anchors, and returns XML.
 */

/**
 * The run's replacement XML under tracking. The old text is renamed to
 * delText by the caller; this only builds the inserted side, and consumes the
 * run's own text-wrapping breaks so the replacement text is the single source
 * of the run's `w:br` elements.
 */
export function replaceRunText(
  source: string,
  anchor: TextRunAnchor,
  text: string,
) {
  const origin = anchor.runRange.start
  const breakReplacements = lineBreakRunReplacements(
    anchor,
    text,
    source,
    origin,
  )
  const consumedBreaks = textBreakReplacements(anchor, origin)
  if (breakReplacements) {
    const broken = applyFragmentReplacements(
      source.slice(anchor.runRange.start, anchor.runRange.end),
      [...breakReplacements, ...consumedBreaks],
    )
    if (broken === undefined) throw new OoxmlError('model-node-not-editable')
    return broken
  }
  const replacements = anchor.textRanges.map((range, index) => ({
    start: range.start - origin,
    end: range.end - origin,
    value: index === 0 ? escapeXmlText(text) : '',
  }))
  replacements.push(...consumedBreaks)
  const first = anchor.textElements[0]
  if (first) {
    const opening = source.slice(first.start, first.startTagEnd)
    const preservedOpening = preserveTextElementXmlSpace(opening, text)
    if (preservedOpening !== opening) {
      replacements.push({
        start: first.start - anchor.runRange.start,
        end: first.startTagEnd - anchor.runRange.start,
        value: preservedOpening,
      })
    }
  }
  const fragment = applyFragmentReplacements(
    source.slice(anchor.runRange.start, anchor.runRange.end),
    replacements,
  )
  if (fragment === undefined) throw new OoxmlError('model-node-not-editable')
  return fragment
}

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
 *
 * `trackedProperties` is the pending property-change replacement a same-batch
 * style or emphasis edit wrote; it folds into the inserted run like the
 * whole-run path, or into the deleted run when nothing is inserted.
 */
export function granularRunEdit(
  source: string,
  anchor: TextRunAnchor,
  text: string,
  prefix: string,
  trackedProperties: string | undefined,
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
    const deletedRun = `${run.open}${rpr}<${prefix}:delText${textElementXmlSpaceAttribute(removed)}>${escapeXmlText(removed)}</${prefix}:delText>${runClose}`
    pieces.deletedRun =
      inserted === '' && trackedProperties
        ? foldRprIntoRun(deletedRun, trackedProperties, prefix, 'rPr')
        : deletedRun
  }
  if (inserted !== '') {
    const insertedRun = `${run.open}${rpr}${wordRunInnerTextXml(prefix, inserted)}${runClose}`
    pieces.insertedRun = trackedProperties
      ? foldRprIntoRun(insertedRun, trackedProperties, prefix, 'rPr')
      : insertedRun
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

export function renameTextElements(
  fragment: string,
  anchor: TextRunAnchor,
  localName: 'delText',
) {
  const renamed = renameFragmentElements(
    fragment,
    anchor.runRange.start,
    anchor.textElements.map((range) => ({ range })),
    localName,
  )
  if (renamed === undefined) throw new OoxmlError('model-node-not-editable')
  return renamed
}

export function wordPrefix(
  source: string,
  range: XmlElementRange,
  localName: 'p' | 'r',
) {
  const opening = source.slice(range.start, range.startTagEnd)
  const qualified = opening.match(/^<([^\s/>]+)/u)?.[1]
  if (!qualified || !qualified.endsWith(`:${localName}`)) {
    throw new OoxmlError('model-node-not-editable')
  }
  return qualified.slice(0, qualified.indexOf(':'))
}

export function insertedRunFragment(value: string, prefix: string) {
  // The tracked-text replacement's property host is the inserted run when one
  // exists; a granular pure deletion emits only `w:del`, so the host falls
  // back to the deleted run — the property change belongs to the run the text
  // came from, and dropping it would lose a same-batch style or emphasis edit.
  let start = value.indexOf(`<${prefix}:ins`)
  if (start === -1) start = value.indexOf(`<${prefix}:del`)
  if (start === -1) return undefined
  const openEnd = value.indexOf('>', start)
  if (openEnd === -1) return undefined
  const runStart = value.indexOf(`<${prefix}:r`, openEnd)
  if (runStart === -1) return undefined
  const runEnd = value.indexOf(`</${prefix}:r>`, runStart)
  if (runEnd === -1) return undefined
  const end = runEnd + `</${prefix}:r>`.length
  return { runStart, runEnd: end, runXml: value.slice(runStart, end) }
}

export function foldRprIntoInsertedRun(
  value: string,
  rprXml: string,
  prefix: string,
  propertiesName: 'rPr' | 'pPr',
) {
  const run = insertedRunFragment(value, prefix)
  if (!run) return value
  const folded = foldRprIntoRun(run.runXml, rprXml, prefix, propertiesName)
  return `${value.slice(0, run.runStart)}${folded}${value.slice(run.runEnd)}`
}

export function foldRprIntoRun(
  runXml: string,
  rprXml: string,
  prefix: string,
  propertiesName: 'rPr' | 'pPr',
) {
  const existing = runXml.match(
    new RegExp(
      `<${prefix}:${propertiesName}\\b[^>]*>[\\s\\S]*?</${prefix}:${propertiesName}>|<${prefix}:${propertiesName}\\b[^>]*/>`,
      'u',
    ),
  )
  if (existing?.index !== undefined) {
    return (
      runXml.slice(0, existing.index) +
      rprXml +
      runXml.slice(existing.index + existing[0].length)
    )
  }
  const openingEnd = runXml.indexOf('>') + 1
  return `${runXml.slice(0, openingEnd)}${rprXml}${runXml.slice(openingEnd)}`
}

export function extractInsertedRunRpr(
  value: string,
  prefix: string,
  propertiesName: 'rPr' | 'pPr',
) {
  const run = insertedRunFragment(value, prefix)
  if (!run) return `<${prefix}:${propertiesName}/>`
  const match = run.runXml.match(
    new RegExp(
      `<${prefix}:${propertiesName}\\b[^>]*>[\\s\\S]*?</${prefix}:${propertiesName}>|<${prefix}:${propertiesName}\\b[^>]*/>`,
      'u',
    ),
  )
  return match?.[0] ?? `<${prefix}:${propertiesName}/>`
}

export function stripPropertyChange(
  properties: string,
  prefix: string,
  propertiesName: 'pPr' | 'rPr',
) {
  return properties.replace(
    new RegExp(
      `<${prefix}:${propertiesName}Change[\\s\\S]*?</${prefix}:${propertiesName}Change>`,
      'u',
    ),
    '',
  )
}

export function appendPropertyChange(
  properties: string,
  prefix: string,
  propertiesName: 'pPr' | 'rPr',
  attributes: string,
  previous: string,
) {
  const marker = `<${prefix}:${propertiesName}Change ${attributes}>${previous}</${prefix}:${propertiesName}Change>`
  if (/\/\s*>$/u.test(properties)) {
    return expandSelfClosingProperties(
      properties,
      prefix,
      propertiesName,
      marker,
    )
  }
  return properties.replace(/(<\/[^>]+>)$/u, `${marker}$1`)
}

export function styleInstruction(
  prefix: string,
  name: string,
  styleId: string,
) {
  return `<${prefix}:${name} ${prefix}:val="${escapeXmlAttribute(styleId)}"/>`
}

export function patchStyleChild(
  fragment: string,
  prefix: string,
  propertiesName: 'pPr' | 'rPr',
  styleName: 'pStyle' | 'rStyle',
  styleId: string | null,
) {
  const styleElement = fragment.match(
    new RegExp(`<${prefix}:${styleName}\\b[^>]*?/>`, 'u'),
  )?.[0]
  if (styleElement) {
    if (styleId === null) return fragment.replace(styleElement, '')
    const patched = styleElement.replace(
      /(\s+(?:[^\s:>]+:)?val\s*=\s*)(["'])([^"']*)\2/u,
      `$1$2${escapeXmlAttribute(styleId)}$2`,
    )
    return fragment.replace(styleElement, patched)
  }
  if (styleId === null) return fragment
  const instruction = styleInstruction(prefix, styleName, styleId)
  if (/\/\s*>$/u.test(fragment)) {
    return expandSelfClosingProperties(
      fragment,
      prefix,
      propertiesName,
      instruction,
    )
  }
  // CT_RPr/CT_PPr require rStyle/pStyle to be the first child, so a missing
  // style element lands right after the open tag, before existing children
  // and before any emphasis already merged into the same replacement.
  const openingEnd = fragment.indexOf('>') + 1
  return `${fragment.slice(0, openingEnd)}${instruction}${fragment.slice(openingEnd)}`
}

export function mergeTrackedProperties(
  value: string,
  prefix: string,
  propertiesName: 'pPr' | 'rPr',
  patch: (current: string) => string,
) {
  const changeTag = `<${prefix}:${propertiesName}Change`
  const changeIndex = value.indexOf(changeTag)
  if (changeIndex === -1) return patch(value)
  const closing = `</${prefix}:${propertiesName}>`
  const children = value.slice(0, changeIndex)
  const tail = value.slice(changeIndex)
  const patched = patch(`${children}${closing}`)
  return patched.endsWith(closing)
    ? `${patched.slice(0, patched.length - closing.length)}${tail}`
    : `${patched}${tail}`
}

export function paragraphMarkDeletionReplacement(
  source: string,
  anchor: ParagraphAnchor,
  prefix: string,
  changeAttributes: string,
) {
  const del = `<${prefix}:del ${changeAttributes}/>`
  const mark = `<${prefix}:rPr>${del}</${prefix}:rPr>`
  const properties = anchor.paragraphPropertiesRange
  if (!properties) {
    return {
      start: anchor.paragraphRange.startTagEnd,
      end: anchor.paragraphRange.startTagEnd,
      value: `<${prefix}:pPr>${mark}</${prefix}:pPr>`,
    }
  }
  return {
    start: properties.start,
    end: properties.end,
    value: insertParagraphMarkDeletion(
      source.slice(properties.start, properties.end),
      prefix,
      del,
      mark,
    ),
  }
}

export function insertParagraphMarkDeletion(
  fragment: string,
  prefix: string,
  del: string,
  mark: string,
) {
  const closeRunProperties = `</${prefix}:rPr>`
  const closeIndex = fragment.lastIndexOf(closeRunProperties)
  if (closeIndex !== -1) {
    return fragment.slice(0, closeIndex) + del + fragment.slice(closeIndex)
  }
  const selfClosingRun = new RegExp(`<${prefix}:rPr([^>]*?)/\\s*>`, 'u')
  if (selfClosingRun.test(fragment)) {
    return fragment.replace(
      selfClosingRun,
      `<${prefix}:rPr$1>${del}</${prefix}:rPr>`,
    )
  }
  if (/\/\s*>$/u.test(fragment)) {
    return expandSelfClosingProperties(fragment, prefix, 'pPr', mark)
  }
  return fragment.replace(/(<\/[^>]+>)$/u, `${mark}$1`)
}
