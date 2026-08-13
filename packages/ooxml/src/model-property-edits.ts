import type {
  OoxmlDocument,
  ParagraphAnchor,
  TextRunAnchor,
  XmlElementRange,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { expandSelfClosingProperties } from './model-style-edits'
import {
  escapeXmlAttribute,
  setOverlayReplacement,
  type XmlOverlay,
} from './parts/overlay'

export type RunEmphasis = {
  bold?: boolean | null
  italic?: boolean | null
  underline?: boolean | null
}

export type ParagraphNumbering = {
  numId: string | null
  ilvl?: number
}

export function setRunEmphasis(
  document: OoxmlDocument,
  anchor: TextRunAnchor,
  emphasis: RunEmphasis,
) {
  const part = requireEditablePart(document, anchor.partName)
  writePropertyChildren(part.overlay, {
    id: anchor.wire.id,
    nodeRange: anchor.runRange,
    propertiesRange: anchor.runPropertiesRange,
    propertiesName: 'rPr',
    children: [
      ['b', flagInstruction('b', emphasis.bold), emphasis.bold !== undefined],
      [
        'i',
        flagInstruction('i', emphasis.italic),
        emphasis.italic !== undefined,
      ],
      [
        'u',
        underlineInstruction(emphasis.underline),
        emphasis.underline !== undefined,
      ],
    ],
  })
  patchWireFragments(
    anchor.wire,
    (xml) => patchRunEmphasisXml(xml, emphasis),
    '<w:rPr/>',
  )
  part.dirty = true
}

export function setParagraphNumbering(
  document: OoxmlDocument,
  anchor: ParagraphAnchor,
  numbering: ParagraphNumbering,
) {
  const part = requireEditablePart(document, anchor.partName)
  const instruction =
    numbering.numId === null
      ? ''
      : `<w:numPr><w:ilvl w:val="${String(numbering.ilvl ?? 0)}"/><w:numId w:val="${escapeXmlAttribute(numbering.numId)}"/></w:numPr>`
  writePropertyChildren(part.overlay, {
    id: anchor.wire.id,
    nodeRange: anchor.paragraphRange,
    propertiesRange: anchor.paragraphPropertiesRange,
    propertiesName: 'pPr',
    children: [['numPr', instruction, true]],
  })
  patchWireFragments(
    anchor.wire,
    (xml) => patchParagraphNumberingXml(xml, numbering),
    '<w:pPr/>',
  )
  part.dirty = true
}

export function patchRunEmphasisXml(fragment: string, emphasis: RunEmphasis) {
  let next = fragment.trim() === '' ? '<w:rPr/>' : fragment
  if (emphasis.bold !== undefined) next = upsertFlag(next, 'b', emphasis.bold)
  if (emphasis.italic !== undefined)
    next = upsertFlag(next, 'i', emphasis.italic)
  if (emphasis.underline !== undefined)
    next = upsertUnderline(next, emphasis.underline)
  return next
}

export function patchParagraphNumberingXml(
  fragment: string,
  numbering: ParagraphNumbering,
) {
  const base =
    fragment.trim() === '' ? '<w:pPr/>' : stripChild(fragment, 'numPr')
  if (numbering.numId === null) return base
  const ilvl = numbering.ilvl ?? 0
  return insertChild(
    base,
    `<w:numPr><w:ilvl w:val="${String(ilvl)}"/><w:numId w:val="${escapeXmlAttribute(numbering.numId)}"/></w:numPr>`,
  )
}

function writePropertyChildren(
  overlay: XmlOverlay,
  input: {
    id: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    propertiesName: 'pPr' | 'rPr'
    children: ReadonlyArray<[string, string, boolean]>
  },
) {
  const range = input.propertiesRange
  if (!range) {
    const inner = input.children
      .filter(([, instruction, apply]) => apply && instruction)
      .map(([, instruction]) => instruction)
      .join('')
    if (!inner) return
    setOverlayReplacement(overlay, `${input.id}:${input.propertiesName}`, {
      start: input.nodeRange.startTagEnd,
      end: input.nodeRange.startTagEnd,
      value: `<w:${input.propertiesName}>${inner}</w:${input.propertiesName}>`,
    })
    return
  }
  const fragment = overlay.source.slice(range.start, range.end)
  if (/\/\s*>$/u.test(fragment)) {
    const inner = input.children
      .filter(([, instruction, apply]) => apply && instruction)
      .map(([, instruction]) => instruction)
      .join('')
    setOverlayReplacement(overlay, `${input.id}:${input.propertiesName}`, {
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
  for (const [localName, instruction, apply] of input.children) {
    if (!apply) continue
    const child = findChildRange(overlay.source, range, localName)
    if (child) {
      setOverlayReplacement(overlay, `${input.id}:${localName}`, {
        start: child.start,
        end: child.end,
        value: instruction,
      })
      continue
    }
    if (!instruction) continue
    setOverlayReplacement(overlay, `${input.id}:${localName}`, {
      start: range.startTagEnd,
      end: range.startTagEnd,
      value: instruction,
    })
  }
}

function findChildRange(
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

function flagInstruction(
  localName: 'b' | 'i',
  value: boolean | null | undefined,
) {
  if (value === undefined || value === null) return ''
  return value ? `<w:${localName}/>` : `<w:${localName} w:val="0"/>`
}

function underlineInstruction(value: boolean | null | undefined) {
  if (value === undefined || value === null) return ''
  return value ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>'
}

function upsertFlag(
  fragment: string,
  localName: 'b' | 'i',
  value: boolean | null,
) {
  const without = stripChild(fragment, localName)
  if (value === null) return without
  return insertChild(
    without,
    value ? `<w:${localName}/>` : `<w:${localName} w:val="0"/>`,
  )
}

function upsertUnderline(fragment: string, value: boolean | null) {
  const without = stripChild(fragment, 'u')
  if (value === null) return without
  return insertChild(
    without,
    value ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>',
  )
}

function stripChild(fragment: string, localName: string) {
  return fragment.replace(
    new RegExp(
      `<w:${localName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${localName}>)`,
      'u',
    ),
    '',
  )
}

function insertChild(fragment: string, instruction: string) {
  if (/\/\s*>$/u.test(fragment)) {
    const name = /<w:(pPr|rPr)\b/u.exec(fragment)?.[1]
    if (name === 'pPr' || name === 'rPr') {
      return expandSelfClosingProperties(fragment, 'w', name, instruction)
    }
  }
  return fragment.replace(/(<\/[^>]+>)$/u, `${instruction}$1`)
}

function patchWireFragments(
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
