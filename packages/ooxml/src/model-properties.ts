import type { XmlElementRange } from './model'
import { setOverlayReplacement, type XmlOverlay } from './parts/overlay'

export type PropertyChild = {
  localName: string
  instruction: string
  apply: boolean
}

// Shared pPr/rPr child writer. All untracked property writers (style,
// emphasis, numbering) route child writes through this patcher so a batch
// that touches the same properties element more than once (for example
// set_paragraph_style + set_paragraph_numbering in one save) expands absent
// or self-closing elements exactly once per node and merges further children
// into the same replacement instead of writing sibling <w:pPr> elements or
// overlapping full-range replacements.
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
    setOverlayReplacement(overlay, key, {
      start: input.nodeRange.startTagEnd,
      end: input.nodeRange.startTagEnd,
      value: `<w:${input.propertiesName}>${inner}</w:${input.propertiesName}>`,
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
    setOverlayReplacement(overlay, `${input.id}:${child.localName}`, {
      start: range.startTagEnd,
      end: range.startTagEnd,
      value: child.instruction,
    })
  }
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
  const match = inner.match(
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
  const closing = `</w:${propertiesName}>`
  // pStyle/rStyle must stay the first child of pPr/rPr (OOXML sequence).
  // When a style write merges into an element another writer already
  // created, insert it before the first non-style child instead of at the
  // end.
  if (/^<w:(?:pStyle|rStyle)\b/u.test(inner)) {
    const firstChild = elementXml.search(/<w:(?:numPr|b|i|u)\b/u)
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
