import { OoxmlError, type OoxmlDocument, type ParagraphAnchor } from './model'
import { requireEditablePart } from './model-edit-overlay'
import { writePropertyChildren } from './model-properties'
import { insertPropertyChild, stripPropertyChild } from './property-xml'
import { escapeXmlAttribute, setOverlayReplacement } from './parts/overlay'

export type ParagraphNumbering = {
  numId: string | null
  ilvl?: number
  /**
   * Restart the list at this number. The untracked writer points the paragraph
   * at a numbering instance carrying the override; the tracked writer folds the
   * same resolved instance into its `w:pPrChange`.
   */
  startOverride?: number | null
}

export function setParagraphNumbering(
  document: OoxmlDocument,
  anchor: ParagraphAnchor,
  numbering: ParagraphNumbering,
) {
  const part = requireEditablePart(document, anchor.partName)
  const resolved = resolveParagraphNumbering(document, numbering)
  const instruction = resolved.numId === null ? '' : numPrInstruction(resolved)
  writePropertyChildren(part.overlay, {
    id: anchor.wire.id,
    nodeRange: anchor.paragraphRange,
    propertiesRange: anchor.paragraphPropertiesRange,
    propertiesName: 'pPr',
    children: [{ localName: 'numPr', instruction, apply: true }],
  })
  patchParagraphFragments(
    anchor.wire,
    (xml) => patchParagraphNumberingXml(xml, resolved),
    '<w:pPr/>',
  )
  part.dirty = true
}

/**
 * Resolves the numbering instance a `w:numPr` should reference. When no start
 * override is asked for, the requested `numId` is written unchanged. When one
 * is, the paragraph must point at an instance whose `w:lvlOverride` carries the
 * override, so a matching existing instance is reused or a new `w:num` is
 * created in `word/numbering.xml` and registered on the model.
 */
export function resolveParagraphNumbering(
  document: OoxmlDocument,
  numbering: ParagraphNumbering,
): ParagraphNumbering {
  const start = numbering.startOverride
  if (numbering.numId === null || start === null || start === undefined) {
    return numbering
  }
  const ilvl = numbering.ilvl ?? 0
  const source = document.model.numbering.find(
    (instance) => instance.numberingId === numbering.numId,
  )
  const abstractId = source?.abstractNumberingId
  if (!source || !abstractId) throw new OoxmlError('invalid-document-edit')
  const existing = document.model.numbering.find(
    (instance) =>
      instance.abstractNumberingId === abstractId &&
      hasPureStartOverride(instance.sourceFragment, ilvl, start),
  )
  if (existing) {
    return { numId: existing.numberingId, ilvl, startOverride: start }
  }
  return {
    numId: createNumberingOverride(document, source, abstractId, ilvl, start),
    ilvl,
    startOverride: start,
  }
}

export function patchParagraphNumberingXml(
  fragment: string,
  numbering: ParagraphNumbering,
) {
  const base =
    fragment.trim() === '' ? '<w:pPr/>' : stripPropertyChild(fragment, 'numPr')
  if (numbering.numId === null) return base
  return insertPropertyChild(base, 'numPr', numPrInstruction(numbering))
}

function numPrInstruction(numbering: ParagraphNumbering) {
  const ilvl = numbering.ilvl ?? 0
  return `<w:numPr><w:ilvl w:val="${String(ilvl)}"/><w:numId w:val="${escapeXmlAttribute(numbering.numId ?? '')}"/></w:numPr>`
}

/**
 * Appends a `w:num` that references the same abstract numbering as `source`
 * with a `w:lvlOverride`/`w:startOverride` for one level. It is registered on
 * the model so a later operation in the same batch can de-duplicate against it
 * and so validation sees it.
 */
function createNumberingOverride(
  document: OoxmlDocument,
  source: OoxmlDocument['model']['numbering'][number],
  abstractId: string,
  ilvl: number,
  start: number,
) {
  const part = requireEditablePart(document, numberingPartName(document))
  const prefix = numberingPrefix(part.overlay.source)
  const numberingId = nextNumberingId(document)
  const sourceFragment = buildOverrideFragment(
    source.sourceFragment,
    prefix,
    abstractId,
    numberingId,
    ilvl,
    start,
  )
  const close = `</${qualify(prefix, 'numbering')}>`
  const closeAt = part.overlay.source.lastIndexOf(close)
  if (closeAt === -1) throw new OoxmlError('invalid-document-edit')
  const at = insertionBeforeCleanup(
    part.overlay.source,
    closeAt,
    qualify(prefix, 'numIdMacAtCleanup'),
  )
  setOverlayReplacement(part.overlay, `numbering:num:${numberingId}`, {
    start: at,
    end: at,
    value: sourceFragment,
  })
  part.dirty = true
  document.model.numbering.push({
    numberingId,
    abstractNumberingId: abstractId,
    startOverride: start,
    sourceFragment,
    ...(source.levels
      ? {
          levels: source.levels.map((level) =>
            level.ilvl === ilvl ? { ...level, start } : { ...level },
          ),
        }
      : {}),
  })
  return numberingId
}

/**
 * The `w:num` a restart points at. It carries the new `w:lvlOverride` for the
 * restarted level plus a verbatim copy of the source instance's other
 * overrides, so the emitted XML and the model entry the caller registers
 * describe the same levels. Omitting them would make the model claim
 * formatting the saved part does not carry.
 */
function buildOverrideFragment(
  sourceFragment: string,
  prefix: string,
  abstractId: string,
  numberingId: string,
  ilvl: number,
  start: number,
) {
  const num = qualify(prefix, 'num')
  const numId = qualify(prefix, 'numId')
  const abstractNumId = qualify(prefix, 'abstractNumId')
  const val = qualify(prefix, 'val')
  const lvlOverride = qualify(prefix, 'lvlOverride')
  const startOverride = qualify(prefix, 'startOverride')
  const overrides = sourceLevelOverrides(sourceFragment)
  const target = overrides.find((override) => override.ilvl === ilvl)
  const nested = target ? nestedLevelXml(target.xml) : undefined
  const copied = overrides
    .filter((override) => override.ilvl !== ilvl)
    .map((override) => override.xml)
    .join('')
  return (
    `<${num} ${numId}="${numberingId}">` +
    `<${abstractNumId} ${val}="${escapeXmlAttribute(abstractId)}"/>` +
    `<${lvlOverride} ${qualify(prefix, 'ilvl')}="${String(ilvl)}">` +
    (nested ?? '') +
    `<${startOverride} ${val}="${String(start)}"/>` +
    `</${lvlOverride}>` +
    copied +
    `</${num}>`
  )
}

function sourceLevelOverrides(fragment: string) {
  return [
    ...fragment.matchAll(
      /<(?:\w+:)?lvlOverride\b[^>]*>[\s\S]*?<\/(?:\w+:)?lvlOverride>/gu,
    ),
  ].flatMap((match) => {
    const level = Number(match[0].match(/\bilvl\s*=\s*["'](\d+)["']/u)?.[1])
    return Number.isInteger(level) ? [{ ilvl: level, xml: match[0] }] : []
  })
}

function nestedLevelXml(overrideXml: string) {
  return overrideXml.match(
    /<(?:\w+:)?lvl\b[^>]*>[\s\S]*?<\/(?:\w+:)?lvl>/u,
  )?.[0]
}

/**
 * Insert a new `w:num` before a trailing `w:numIdMacAtCleanup`. `CT_Numbering`
 * orders `num` elements before that element, so appending at the closing tag
 * would be schema-invalid when the part carries one; without it the insertion
 * point is the closing tag.
 */
function insertionBeforeCleanup(
  source: string,
  closeAt: number,
  cleanupName: string,
) {
  const before = source.slice(0, closeAt)
  const trailing = before.match(
    new RegExp(
      `<${cleanupName}\\b[^>]*(?:/>|>[\\s\\S]*?</${cleanupName}>)\\s*$`,
      'u',
    ),
  )
  return trailing ? before.length - trailing[0].length : closeAt
}

function qualify(prefix: string, name: string) {
  return prefix ? `${prefix}:${name}` : name
}

/** The color of a clean override: one level override that changes only start. */
export function hasPureStartOverride(
  fragment: string,
  ilvl: number,
  start: number,
) {
  const overrides = [
    ...fragment.matchAll(
      /<(?:\w+:)?lvlOverride\b([^>]*)>([\s\S]*?)<\/(?:\w+:)?lvlOverride>/gu,
    ),
  ]
  if (overrides.length !== 1) return false
  const attributes = overrides[0]?.[1] ?? ''
  const body = overrides[0]?.[2] ?? ''
  if (
    !new RegExp(`\\bilvl\\s*=\\s*["']${String(ilvl)}["']`, 'u').test(attributes)
  ) {
    return false
  }
  // A nested `w:lvl` overrides the level's formatting, not just its start, so
  // it is not a pure restart instance and must not be reused.
  if (/<(?:\w+:)?lvl\b/u.test(body)) return false
  return new RegExp(
    `<(?:\\w+:)?startOverride\\b[^>]*\\bval\\s*=\\s*["']${String(start)}["']`,
    'u',
  ).test(body)
}

function numberingPartName(document: OoxmlDocument) {
  const part = [...document.sourceParts.values()].find(
    (candidate) => candidate.role === 'numbering',
  )
  if (!part) throw new OoxmlError('invalid-document-edit')
  return part.name
}

function numberingPrefix(source: string) {
  return source.match(/<([A-Za-z_][\w.-]*):numbering\b/u)?.[1] ?? ''
}

function nextNumberingId(document: OoxmlDocument) {
  let max = 0
  for (const instance of document.model.numbering) {
    const value = Number(instance.numberingId)
    if (Number.isInteger(value) && value > max) max = value
  }
  return String(max + 1)
}

function patchParagraphFragments(
  wire: { preservedXmlFragments: string[] },
  patch: (xml: string) => string,
  empty: string,
) {
  const index = wire.preservedXmlFragments.findIndex((fragment) =>
    /<w:(?:rPr|pPr)\b/u.test(fragment),
  )
  if (index === -1) {
    wire.preservedXmlFragments.push(patch(empty))
    return
  }
  wire.preservedXmlFragments[index] = patch(
    wire.preservedXmlFragments[index] ?? empty,
  )
}
