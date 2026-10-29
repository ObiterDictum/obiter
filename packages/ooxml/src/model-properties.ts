import type { XmlElementRange } from './model'
import { setOverlayReplacement, type XmlOverlay } from './parts/overlay'

export type PropertyChild = {
  localName: string
  instruction: string
  apply: boolean
}

export function writePropertyChildren(
  overlay: XmlOverlay,
  input: {
    id: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    propertiesName: 'pPr' | 'rPr'
    children: ReadonlyArray<PropertyChild>
  },
) {
  const range = input.propertiesRange
  if (!range) {
    const key = `${input.id}:${input.propertiesName}`
    const inner = propertyChildrenXml(input.children)
    const existing = overlay.replacements.get(key)
    if (existing) {
      if (inner) {
        setOverlayReplacement(overlay, key, {
          ...existing,
          value: appendPropertiesChildren(
            existing.value,
            inner,
            input.propertiesName,
          ),
        })
      }
      return
    }
    if (!inner) return
    const n = input.nodeRange
    const selfClosing = n.startTagEnd === n.end
    setOverlayReplacement(overlay, key, {
      start: selfClosing ? n.start : n.startTagEnd,
      end: selfClosing ? n.end : n.startTagEnd,
      value: selfClosing
        ? `${overlay.source.slice(n.start, n.startTagEnd).replace(/\/\s*>$/u, '>')}<w:${input.propertiesName}>${inner}</w:${input.propertiesName}></w:${input.propertiesName === 'pPr' ? 'p' : 'r'}>`
        : `<w:${input.propertiesName}>${inner}</w:${input.propertiesName}>`,
    })
    return
  }
  const fragment = overlay.source.slice(range.start, range.end)
  if (/\/\s*>$/u.test(fragment)) {
    const key = `${input.id}:${input.propertiesName}`
    const inner = propertyChildrenXml(input.children)
    const existing = overlay.replacements.get(key)
    if (existing) {
      if (inner) {
        setOverlayReplacement(overlay, key, {
          ...existing,
          value: appendPropertiesChildren(
            existing.value,
            inner,
            input.propertiesName,
          ),
        })
      }
      return
    }
    if (!inner) return
    setOverlayReplacement(overlay, key, {
      start: range.start,
      end: range.end,
      value: expandSelfClosingProperties(
        fragment,
        'w',
        input.propertiesName,
        inner,
      ),
    })
    return
  }
  for (const child of input.children) {
    if (!child.apply) continue
    const found = findChildRange(overlay.source, range, child.localName)
    if (found) {
      setOverlayReplacement(overlay, `${input.id}:${child.localName}`, {
        start: found.start,
        end: found.end,
        value: child.instruction,
      })
      continue
    }
    if (!child.instruction) continue
    const insertAt = missingChildInsertPosition(
      overlay.source,
      range,
      child.localName,
    )
    setOverlayReplacement(overlay, `${input.id}:${child.localName}`, {
      start: insertAt,
      end: insertAt,
      value: child.instruction,
    })
  }
}

interface PropertyChildPredecessors {
  [localName: string]: readonly string[]
}

const PROPERTY_CHILD_PREDECESSORS: PropertyChildPredecessors = {
  numPr: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
  ],
  spacing: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'adjustRightInd',
    'snapToGrid',
  ],
  ind: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
  ],
  jc: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
    'ind',
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
  ],
  rFonts: ['rStyle'],
  b: ['rStyle', 'rFonts'],
  i: ['rStyle', 'rFonts', 'b', 'bCs'],
  strike: ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps', 'smallCaps'],
  smallCaps: ['rStyle', 'rFonts', 'b', 'bCs', 'i', 'iCs', 'caps'],
  color: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
  ],
  sz: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
  ],
  szCs: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
  ],
  highlight: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
  ],
  vertAlign: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
    'highlight',
    'u',
    'effect',
    'bdr',
    'shd',
    'fitText',
  ],
  u: [
    'rStyle',
    'rFonts',
    'b',
    'bCs',
    'i',
    'iCs',
    'caps',
    'smallCaps',
    'strike',
    'dstrike',
    'outline',
    'shadow',
    'emboss',
    'imprint',
    'noProof',
    'snapToGrid',
    'vanish',
    'webHidden',
    'color',
    'spacing',
    'w',
    'kern',
    'position',
    'sz',
    'szCs',
    'highlight',
  ],
  sectPr: [
    'pStyle',
    'keepNext',
    'keepLines',
    'pageBreakBefore',
    'framePr',
    'widowControl',
    'numPr',
    'suppressLineNumbers',
    'pBdr',
    'shd',
    'tabs',
    'suppressAutoHyphens',
    'kinsoku',
    'wordWrap',
    'overflowPunct',
    'topLinePunct',
    'autoSpaceDE',
    'autoSpaceDN',
    'bidi',
    'adjustRightInd',
    'snapToGrid',
    'spacing',
    'ind',
    'contextualSpacing',
    'mirrorIndents',
    'suppressOverlap',
    'jc',
    'textDirection',
    'textAlignment',
    'textboxTightWrap',
    'outlineLvl',
    'divId',
    'cnfStyle',
    'rPr',
  ],
}

export function activePropertiesContent(content: string) {
  const changeStart = content.search(/<w:(?:pPr|rPr)Change\b/u)
  return changeStart === -1 ? content : content.slice(0, changeStart)
}

export function propertyChildInsertPosition(
  fragment: string,
  localName: string,
) {
  const active = activePropertiesContent(fragment)
  const predecessors = PROPERTY_CHILD_PREDECESSORS[localName] ?? []
  let position = active.indexOf('>') + 1
  for (const name of predecessors) {
    const match = active.match(
      new RegExp(`<w:${name}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${name}>)`, 'u'),
    )
    if (match?.index !== undefined) {
      const end = match.index + match[0].length
      if (end > position) position = end
    }
  }
  return position
}

function missingChildInsertPosition(
  source: string,
  propertiesRange: XmlElementRange,
  localName: string,
) {
  if (localName === 'pStyle' || localName === 'rStyle') {
    return propertiesRange.startTagEnd
  }
  let position = propertiesRange.startTagEnd
  for (const name of PROPERTY_CHILD_PREDECESSORS[localName] ?? []) {
    const child = findChildRange(source, propertiesRange, name)
    if (child && child.end > position) position = child.end
  }
  return position
}

export function expandSelfClosingProperties(
  fragment: string,
  prefix: string,
  propertiesName: 'pPr' | 'rPr',
  content: string,
) {
  return `${fragment.replace(/\/\s*>$/u, '>')}${content}</${prefix}:${propertiesName}>`
}

export function findChildRange(
  source: string,
  propertiesRange: XmlElementRange,
  localName: string,
) {
  const inner = source.slice(
    propertiesRange.startTagEnd,
    propertiesRange.endTagStart,
  )
  const match = activePropertiesContent(inner).match(
    new RegExp(
      `<w:${localName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${localName}>)`,
      'u',
    ),
  )
  if (!match || match.index === undefined) return undefined
  const start = propertiesRange.startTagEnd + match.index
  return { start, end: start + match[0].length }
}

function propertyChildrenXml(children: ReadonlyArray<PropertyChild>) {
  return children
    .filter(({ apply, instruction }) => apply && instruction)
    .map(({ instruction }) => instruction)
    .join('')
}

function appendPropertiesChildren(
  elementXml: string,
  inner: string,
  propertiesName: 'pPr' | 'rPr',
) {
  if (
    propertiesName === 'pPr' &&
    /^<w:p\b/u.test(elementXml) &&
    !/<w:pPr\b/u.test(elementXml)
  ) {
    const openEnd = elementXml.indexOf('>') + 1
    return `${elementXml.slice(0, openEnd)}<w:pPr>${inner}</w:pPr>${elementXml.slice(openEnd)}`
  }
  const closing = `</w:${propertiesName}>`
  if (/^<w:(?:pStyle|rStyle)\b/u.test(inner)) {
    const firstChild = elementXml.search(
      /<w:(?:numPr|b|i|u|rFonts|jc|spacing|ind|color|sz|strike|smallCaps|highlight|vertAlign|sectPr)\b/u,
    )
    if (firstChild !== -1) {
      return (
        elementXml.slice(0, firstChild) + inner + elementXml.slice(firstChild)
      )
    }
  }
  const index = elementXml.lastIndexOf(closing)
  if (index === -1) return `${elementXml}${inner}`
  return `${elementXml.slice(0, index)}${inner}${elementXml.slice(index)}`
}
