import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  activePropertiesContent,
  findChildRange,
  writePropertyChildren,
} from './model-properties'
import { insertPropertyChild, stripPropertyChild } from './property-xml'
import { escapeXmlAttribute } from './parts/overlay'
import { hasPendingBreakSplice } from './run-break-splices'

export type RunEmphasis = {
  bold?: boolean | null
  italic?: boolean | null
  underline?: boolean | null
  fontFamily?: string | null
  fontSize?: number | null
  colour?: string | null
  highlight?: string | null
  strikethrough?: boolean | null
  vertAlign?: string | null
  smallCaps?: boolean | null
}

export type ParagraphFormat = {
  alignment?: 'left' | 'center' | 'right' | 'both' | null
  lineSpacing?: { line: number; lineRule?: 'auto' | 'exact' | 'atLeast' } | null
  spaceBefore?: number | null
  spaceAfter?: number | null
  indentation?: {
    left?: number | null
    right?: number | null
    firstLine?: number | null
    hanging?: number | null
  } | null
}

export function setRunEmphasis(
  document: OoxmlDocument,
  anchor: TextRunAnchor,
  emphasis: RunEmphasis,
) {
  const part = requireEditablePart(document, anchor.partName)
  // A whole-run property write cannot compose with a page-break splice that
  // already reopened the run: the write lands on the first sibling while the
  // tail keeps its parse-time property snapshot, so the wire would claim the
  // whole run is styled while the saved tail is not. Fail closed with a typed
  // edit error instead of saving a mismatch.
  if (hasPendingBreakSplice(part.overlay, anchor.runRange)) {
    throw new OoxmlError('invalid-document-edit')
  }
  writePropertyChildren(part.overlay, {
    id: anchor.wire.id,
    nodeRange: anchor.runRange,
    propertiesRange: anchor.runPropertiesRange,
    propertiesName: 'rPr',
    children: runEmphasisChildren(emphasis),
  })
  patchWireFragments(
    anchor.wire,
    (xml) => patchRunEmphasisXml(xml, emphasis),
    '<w:rPr/>',
  )
  part.dirty = true
}

export function setParagraphFormat(
  document: OoxmlDocument,
  anchor: ParagraphAnchor,
  format: ParagraphFormat,
) {
  const part = requireEditablePart(document, anchor.partName)
  const propsRange = anchor.paragraphPropertiesRange
  const existingSpacing = readElementAttrs(
    part.overlay.source,
    propsRange,
    'spacing',
  )
  const existingInd = readElementAttrs(part.overlay.source, propsRange, 'ind')
  writePropertyChildren(part.overlay, {
    id: anchor.wire.id,
    nodeRange: anchor.paragraphRange,
    propertiesRange: propsRange,
    propertiesName: 'pPr',
    children: paragraphFormatChildren(format, existingSpacing, existingInd),
  })
  patchWireFragments(
    anchor.wire,
    (xml) => patchParagraphFormatXml(xml, format),
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
  if (emphasis.fontFamily !== undefined)
    next = upsertFontFamily(next, emphasis.fontFamily)
  if (emphasis.fontSize !== undefined)
    next = upsertFontSize(next, emphasis.fontSize)
  if (emphasis.colour !== undefined)
    next = upsertValElement(next, 'color', emphasis.colour)
  if (emphasis.highlight !== undefined)
    next = upsertValElement(next, 'highlight', emphasis.highlight)
  if (emphasis.strikethrough !== undefined)
    next = upsertFlag(next, 'strike', emphasis.strikethrough)
  if (emphasis.vertAlign !== undefined)
    next = upsertValElement(next, 'vertAlign', emphasis.vertAlign)
  if (emphasis.smallCaps !== undefined)
    next = upsertFlag(next, 'smallCaps', emphasis.smallCaps)
  return next
}

export function patchParagraphFormatXml(
  fragment: string,
  format: ParagraphFormat,
) {
  let next = fragment.trim() === '' ? '<w:pPr/>' : fragment
  if (format.alignment !== undefined) {
    next =
      format.alignment === null
        ? stripPropertyChild(next, 'jc')
        : upsertValElement(next, 'jc', format.alignment)
  }
  if (
    format.spaceBefore !== undefined ||
    format.spaceAfter !== undefined ||
    format.lineSpacing !== undefined
  ) {
    const spacing = spacingInstruction(spacingAttrsFromFragment(next), format)
    next = spacing
      ? upsertElement(next, 'spacing', spacing)
      : stripPropertyChild(next, 'spacing')
  }
  if (format.indentation !== undefined) {
    next =
      format.indentation === null
        ? stripPropertyChild(next, 'ind')
        : upsertElement(
            next,
            'ind',
            indInstruction(indAttrsFromFragment(next), format),
          )
  }
  return next
}

function runEmphasisChildren(emphasis: RunEmphasis) {
  return [
    {
      localName: 'rFonts',
      instruction: fontFamilyInstruction(emphasis.fontFamily),
      apply: emphasis.fontFamily !== undefined,
    },
    {
      localName: 'b',
      instruction: flagInstruction('b', emphasis.bold),
      apply: emphasis.bold !== undefined,
    },
    {
      localName: 'i',
      instruction: flagInstruction('i', emphasis.italic),
      apply: emphasis.italic !== undefined,
    },
    {
      localName: 'strike',
      instruction: flagInstruction('strike', emphasis.strikethrough),
      apply: emphasis.strikethrough !== undefined,
    },
    {
      localName: 'smallCaps',
      instruction: flagInstruction('smallCaps', emphasis.smallCaps),
      apply: emphasis.smallCaps !== undefined,
    },
    {
      localName: 'color',
      instruction: valInstruction('color', emphasis.colour),
      apply: emphasis.colour !== undefined,
    },
    {
      localName: 'sz',
      instruction: fontSizeSzInstruction(emphasis.fontSize),
      apply: emphasis.fontSize !== undefined,
    },
    {
      localName: 'szCs',
      instruction: fontSizeSzCsInstruction(emphasis.fontSize),
      apply: emphasis.fontSize !== undefined,
    },
    {
      localName: 'highlight',
      instruction: valInstruction('highlight', emphasis.highlight),
      apply: emphasis.highlight !== undefined,
    },
    {
      localName: 'u',
      instruction: underlineInstruction(emphasis.underline),
      apply: emphasis.underline !== undefined,
    },
    {
      localName: 'vertAlign',
      instruction: valInstruction('vertAlign', emphasis.vertAlign),
      apply: emphasis.vertAlign !== undefined,
    },
  ]
}

function paragraphFormatChildren(
  format: ParagraphFormat,
  existingSpacing: Record<string, string>,
  existingInd: Record<string, string>,
) {
  const spacing =
    format.spaceBefore !== undefined ||
    format.spaceAfter !== undefined ||
    format.lineSpacing !== undefined
      ? spacingInstruction(existingSpacing, format)
      : ''
  const ind =
    format.indentation !== undefined && format.indentation !== null
      ? indInstruction(existingInd, format)
      : ''
  return [
    {
      localName: 'spacing',
      instruction: spacing,
      apply:
        format.spaceBefore !== undefined ||
        format.spaceAfter !== undefined ||
        format.lineSpacing !== undefined,
    },
    {
      localName: 'ind',
      instruction: ind,
      apply: format.indentation !== undefined,
    },
    {
      localName: 'jc',
      instruction: valInstruction('jc', format.alignment),
      apply: format.alignment !== undefined,
    },
  ]
}

function flagInstruction(
  localName: 'b' | 'i' | 'strike' | 'smallCaps',
  value: boolean | null | undefined,
) {
  if (value === undefined || value === null) return ''
  return value ? `<w:${localName}/>` : `<w:${localName} w:val="0"/>`
}

function underlineInstruction(value: boolean | null | undefined) {
  if (value === undefined || value === null) return ''
  return value ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>'
}

function fontFamilyInstruction(value: string | null | undefined) {
  if (value === undefined || value === null) return ''
  const name = escapeXmlAttribute(value)
  return `<w:rFonts w:ascii="${name}" w:hAnsi="${name}"/>`
}

function fontSizeSzInstruction(value: number | null | undefined) {
  if (value === undefined || value === null) return ''
  return `<w:sz w:val="${String(value)}"/>`
}

function fontSizeSzCsInstruction(value: number | null | undefined) {
  if (value === undefined || value === null) return ''
  return `<w:szCs w:val="${String(value)}"/>`
}

function valInstruction(localName: string, value: string | null | undefined) {
  if (value === undefined || value === null) return ''
  return `<w:${localName} w:val="${escapeXmlAttribute(value)}"/>`
}

function spacingInstruction(
  existing: Record<string, string>,
  format: ParagraphFormat,
) {
  const attrs = { ...existing }
  if (format.spaceBefore !== undefined) {
    if (format.spaceBefore === null) delete attrs.before
    else attrs.before = String(format.spaceBefore)
  }
  if (format.spaceAfter !== undefined) {
    if (format.spaceAfter === null) delete attrs.after
    else attrs.after = String(format.spaceAfter)
  }
  if (format.lineSpacing !== undefined) {
    if (format.lineSpacing === null) {
      delete attrs.line
      delete attrs.lineRule
    } else {
      attrs.line = String(format.lineSpacing.line)
      if (format.lineSpacing.lineRule !== undefined) {
        attrs.lineRule = format.lineSpacing.lineRule
      }
    }
  }
  return twipElement('spacing', attrs)
}

function indInstruction(
  existing: Record<string, string>,
  format: ParagraphFormat,
) {
  const indent = format.indentation
  if (!indent) return ''
  const attrs = { ...existing }
  for (const key of ['left', 'right', 'firstLine', 'hanging'] as const) {
    const value = indent[key]
    if (value === undefined) continue
    if (value === null) delete attrs[key]
    else attrs[key] = String(value)
  }
  if (indent.firstLine != null) delete attrs.hanging
  if (indent.hanging != null) delete attrs.firstLine
  return twipElement('ind', attrs)
}

function twipElement(localName: string, attrs: Record<string, string>) {
  const keys = Object.keys(attrs)
  if (keys.length === 0) return ''
  const body = keys
    .map((key) => {
      const value = attrs[key]
      return value === undefined
        ? ''
        : ` w:${key}="${escapeXmlAttribute(value)}"`
    })
    .join('')
  return `<w:${localName}${body}/>`
}

function readElementAttrs(
  source: string,
  propertiesRange: XmlElementRange | undefined,
  localName: string,
) {
  if (!propertiesRange) return {}
  const child = findChildRange(source, propertiesRange, localName)
  if (!child) return {}
  return attrsFromElement(source.slice(child.start, child.end))
}

function spacingAttrsFromFragment(fragment: string) {
  const match = activePropertiesContent(fragment).match(
    /<w:spacing\b([^>]*?)\/?>/u,
  )
  return match ? attrsFromAttributes(match[1] ?? '') : {}
}

function indAttrsFromFragment(fragment: string) {
  const match = activePropertiesContent(fragment).match(/<w:ind\b([^>]*?)\/?>/u)
  return match ? attrsFromAttributes(match[1] ?? '') : {}
}

function attrsFromElement(element: string) {
  const open = element.match(/^<[^>]+>/u)?.[0] ?? element
  return attrsFromAttributes(open)
}

function attrsFromAttributes(raw: string) {
  const attrs: Record<string, string> = {}
  for (const match of raw.matchAll(/\bw:(\w+)\s*=\s*"([^"]*)"/gu)) {
    const name = match[1]
    const value = match[2]
    if (name === undefined || value === undefined) continue
    attrs[name] = value
  }
  return attrs
}

function upsertFlag(
  fragment: string,
  localName: 'b' | 'i' | 'strike' | 'smallCaps',
  value: boolean | null,
) {
  const without = stripPropertyChild(fragment, localName)
  if (value === null) return without
  return insertPropertyChild(
    without,
    localName,
    value ? `<w:${localName}/>` : `<w:${localName} w:val="0"/>`,
  )
}

function upsertUnderline(fragment: string, value: boolean | null) {
  const without = stripPropertyChild(fragment, 'u')
  if (value === null) return without
  return insertPropertyChild(
    without,
    'u',
    value ? '<w:u w:val="single"/>' : '<w:u w:val="none"/>',
  )
}

function upsertFontFamily(fragment: string, value: string | null) {
  const without = stripPropertyChild(fragment, 'rFonts')
  if (value === null) return without
  const name = escapeXmlAttribute(value)
  return insertPropertyChild(
    without,
    'rFonts',
    `<w:rFonts w:ascii="${name}" w:hAnsi="${name}"/>`,
  )
}

function upsertFontSize(fragment: string, value: number | null) {
  let next = stripPropertyChild(fragment, 'sz')
  next = stripPropertyChild(next, 'szCs')
  if (value === null) return next
  next = insertPropertyChild(next, 'sz', `<w:sz w:val="${String(value)}"/>`)
  return insertPropertyChild(next, 'szCs', `<w:szCs w:val="${String(value)}"/>`)
}

function upsertValElement(
  fragment: string,
  localName: string,
  value: string | null,
) {
  const without = stripPropertyChild(fragment, localName)
  if (value === null) return without
  return insertPropertyChild(
    without,
    localName,
    `<w:${localName} w:val="${escapeXmlAttribute(value)}"/>`,
  )
}

function upsertElement(
  fragment: string,
  localName: string,
  instruction: string,
) {
  const without = stripPropertyChild(fragment, localName)
  if (!instruction) return without
  return insertPropertyChild(without, localName, instruction)
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
