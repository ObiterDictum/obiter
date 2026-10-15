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
 *
 * The target override's children are `w:startOverride` then `w:lvl`, the order
 * CT_NumLvl requires. A source that redefined the target level with a nested
 * `w:lvl` keeps that level — dropping it would silently change the list's
 * formatting and desync the model entry, which records the source level — but
 * its own `w:start` is rewritten to the restart value so a consumer that reads
 * only the nested level still restarts. The two elements cannot then disagree.
 */
export function buildOverrideFragment(
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
  const overrides = levelOverrides(sourceFragment)
  const target = overrides.find((override) => override.ilvl === ilvl)
  const nested = target
    ? restartedLevelXml(target.xml, prefix, start)
    : undefined
  const copied = overrides
    .filter((override) => override.ilvl !== ilvl)
    .map((override) => override.xml)
    .join('')
  return (
    `<${num} ${numId}="${numberingId}">` +
    `<${abstractNumId} ${val}="${escapeXmlAttribute(abstractId)}"/>` +
    `<${lvlOverride} ${qualify(prefix, 'ilvl')}="${String(ilvl)}">` +
    `<${startOverride} ${val}="${String(start)}"/>` +
    (nested ?? '') +
    `</${lvlOverride}>` +
    copied +
    `</${num}>`
  )
}

/** One `w:lvlOverride`, matched as a self-closing tag or a paired element. */
type LevelOverride = {
  ilvl: number
  body: string
  xml: string
}

/**
 * Every `w:lvlOverride` in a `w:num`. The self-closing alternative comes first
 * so a `<w:lvlOverride w:ilvl="0"/>` never swallows the body of a later paired
 * override, which a single open/body/close pattern does because it reads the
 * slash as part of the open tag.
 */
function levelOverrides(fragment: string) {
  const result: LevelOverride[] = []
  for (const match of fragment.matchAll(
    /<(?:\w+:)?lvlOverride\b([^>]*?)\/>|<(?:\w+:)?lvlOverride\b([^>]*?)>([\s\S]*?)<\/(?:\w+:)?lvlOverride>/gu,
  )) {
    const selfClosing = match[1] !== undefined
    const attributes = (selfClosing ? match[1] : match[2]) ?? ''
    const body = selfClosing ? '' : (match[3] ?? '')
    const level = Number(attributes.match(/\bilvl\s*=\s*["'](\d+)["']/u)?.[1])
    if (!Number.isInteger(level)) continue
    result.push({ ilvl: level, body, xml: match[0] })
  }
  return result
}

/**
 * The target override's nested `w:lvl` with its own `w:start` set to the
 * restart value. The level is kept so the restart does not change formatting;
 * rewriting the start keeps it from contradicting the sibling `w:startOverride`.
 * A level is expanded from its self-closing form so a schema-valid
 * `<w:lvl .../>` keeps its redefinition instead of vanishing from the saved
 * part; the existing `w:start` rewrite also accepts a paired element so it
 * never leaves a dangling close tag.
 */
function restartedLevelXml(overrideXml: string, prefix: string, start: number) {
  const match = overrideXml.match(
    /<(\w+:)?lvl\b([^>]*?)\/>|<(\w+:)?lvl\b([^>]*?)>([\s\S]*?)<\/(?:\w+:)?lvl>/u,
  )
  if (!match) return undefined
  const selfClosing = match[2] !== undefined
  const tagPrefix = ((selfClosing ? match[1] : match[3]) ?? '').replace(
    /:$/u,
    '',
  )
  const attributes = (selfClosing ? match[2] : match[4]) ?? ''
  const body = selfClosing ? '' : (match[5] ?? '')
  const startXml = `<${qualify(prefix, 'start')} ${qualify(
    prefix,
    'val',
  )}="${String(start)}"/>`
  const startPattern =
    /<(?:\w+:)?start\b[^>]*\/>|<(?:\w+:)?start\b[^>]*>[\s\S]*?<\/(?:\w+:)?start>/u
  const children = startPattern.test(body)
    ? body.replace(startPattern, startXml)
    : `${startXml}${body}`
  const lvl = qualify(tagPrefix, 'lvl')
  return `<${lvl}${attributes}>${children}</${lvl}>`
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
  const overrides = levelOverrides(fragment)
  if (overrides.length !== 1) return false
  const override = overrides[0]
  if (!override || override.ilvl !== ilvl) return false
  // A nested `w:lvl` overrides the level's formatting, not just its start, so
  // it is not a pure restart instance and must not be reused.
  if (/<(?:\w+:)?lvl\b/u.test(override.body)) return false
  return new RegExp(
    `<(?:\\w+:)?startOverride\\b[^>]*\\bval\\s*=\\s*["']${String(start)}["']`,
    'u',
  ).test(override.body)
}

/**
 * The `w:startOverride` an instance declares for one level, read from its raw
 * `w:num`. The instance-level `startOverride` the parser exposes is its first
 * descendant override at any level, so it cannot answer this per-level read.
 * A self-closing `w:lvlOverride` carries no override and is not read.
 */
export function levelStartOverride(
  fragment: string,
  ilvl: number,
): number | undefined {
  const override = levelOverrides(fragment).find(
    (candidate) => candidate.ilvl === ilvl,
  )
  if (!override) return undefined
  const value = override.body.match(
    /<(?:\w+:)?startOverride\b[^>]*\bval\s*=\s*["'](\d+)["']/u,
  )?.[1]
  if (value === undefined) return undefined
  const start = Number(value)
  return Number.isInteger(start) && start > 0 ? start : undefined
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
