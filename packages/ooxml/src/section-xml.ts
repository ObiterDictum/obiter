import { escapeXmlAttribute } from './parts/overlay'

/** Direct page-margin overrides in twips; `null` releases an attribute. */
export type SectionMarginPatch = {
  top?: number | null
  right?: number | null
  bottom?: number | null
  left?: number | null
  header?: number | null
  footer?: number | null
  gutter?: number | null
}

/**
 * A narrow section-properties patch over the body-level `w:sectPr`.
 *
 * - `margins: null` removes `w:pgMar`; a field `null` removes just that attribute.
 * - `pageSize: null` removes `w:pgSz`; `orientation: null` removes `w:orient`.
 * - `orientation` alone swaps the current `w:w`/`w:h` to match. An explicit
 *   `pageSize` is authoritative and is not swapped, so `w:orient` is derived
 *   from the resulting dimensions when only a size is given.
 */
export type SectionPropertiesPatch = {
  margins?: SectionMarginPatch | null
  orientation?: 'portrait' | 'landscape' | null
  pageSize?: { width: number; height: number } | null
}

/** Word's A4 page size in twips, matching the reading side's default. */
export const A4_PAGE_TWIPS = { width: 11_906, height: 16_838 }

const MARGIN_ATTRIBUTES = [
  'top',
  'right',
  'bottom',
  'left',
  'header',
  'footer',
  'gutter',
] as const

// CT_SectPr (ECMA-376) child order for the two properties E5 writes. A missing
// child must land after the last present predecessor, not immediately after the
// open tag, or the section is schema-invalid.
const SECTION_CHILD_PREDECESSORS = new Map<string, readonly string[]>([
  [
    'pgSz',
    ['headerReference', 'footerReference', 'footnotePr', 'endnotePr', 'type'],
  ],
  [
    'pgMar',
    [
      'headerReference',
      'footerReference',
      'footnotePr',
      'endnotePr',
      'type',
      'pgSz',
    ],
  ],
])

export function patchSectionPropertiesXml(
  sectPr: string,
  patch: SectionPropertiesPatch,
) {
  let next = sectPr.trim() === '' ? '<w:sectPr/>' : sectPr
  if (patch.margins !== undefined) next = patchMargins(next, patch.margins)
  if (patch.pageSize !== undefined || patch.orientation !== undefined) {
    next = patchPageSize(next, patch.pageSize, patch.orientation)
  }
  return next
}

function patchMargins(sectPr: string, margins: SectionMarginPatch | null) {
  if (margins === null) return stripChild(sectPr, 'pgMar')
  const attrs = childAttributes(sectPr, 'pgMar')
  for (const name of MARGIN_ATTRIBUTES) {
    const value = margins[name]
    if (value === undefined) continue
    if (value === null) delete attrs[name]
    else attrs[name] = String(value)
  }
  if (Object.keys(attrs).length === 0) return stripChild(sectPr, 'pgMar')
  return upsertChild(sectPr, 'pgMar', elementWithAttributes('pgMar', attrs))
}

function patchPageSize(
  sectPr: string,
  pageSize: { width: number; height: number } | null | undefined,
  orientation: 'portrait' | 'landscape' | null | undefined,
) {
  if (pageSize === null) return stripChild(sectPr, 'pgSz')
  const attrs = childAttributes(sectPr, 'pgSz')
  let width = pageSize?.width ?? numberAttribute(attrs.w) ?? A4_PAGE_TWIPS.width
  let height =
    pageSize?.height ?? numberAttribute(attrs.h) ?? A4_PAGE_TWIPS.height
  if (orientation != null && pageSize === undefined) {
    const low = Math.min(width, height)
    const high = Math.max(width, height)
    width = orientation === 'landscape' ? high : low
    height = orientation === 'landscape' ? low : high
  }
  const target =
    orientation !== undefined
      ? orientation
      : pageSize
        ? width > height
          ? 'landscape'
          : 'portrait'
        : attrs.orient === 'landscape'
          ? 'landscape'
          : 'portrait'
  const next = new Map<string, string>(Object.entries(attrs))
  next.set('w', String(width))
  next.set('h', String(height))
  if (target === 'landscape') next.set('orient', 'landscape')
  else next.delete('orient')
  return upsertChild(
    sectPr,
    'pgSz',
    elementWithAttributes('pgSz', Object.fromEntries(next)),
  )
}

function childElement(fragment: string, localName: string) {
  return fragment.match(childPattern(localName))?.[0]
}

function childAttributes(fragment: string, localName: string) {
  const opening =
    childElement(fragment, localName)?.match(/^<[^>]+>/u)?.[0] ?? ''
  const attrs: Record<string, string> = {}
  for (const match of opening.matchAll(/\bw:(\w+)\s*=\s*"([^"]*)"/gu)) {
    const name = match[1]
    const value = match[2]
    if (name !== undefined && value !== undefined) attrs[name] = value
  }
  return attrs
}

function upsertChild(fragment: string, localName: string, instruction: string) {
  if (/\/\s*>$/u.test(fragment)) {
    const open = fragment.replace(/\/\s*>$/u, '>')
    return `${open}${instruction}</w:sectPr>`
  }
  const pattern = childPattern(localName)
  const match = fragment.match(pattern)
  if (match?.index !== undefined) {
    return (
      fragment.slice(0, match.index) +
      instruction +
      fragment.slice(match.index + match[0].length)
    )
  }
  const position = childInsertPosition(fragment, localName)
  return fragment.slice(0, position) + instruction + fragment.slice(position)
}

function stripChild(fragment: string, localName: string) {
  return fragment.replace(childPattern(localName), '')
}

function childInsertPosition(fragment: string, localName: string) {
  let position = fragment.indexOf('>') + 1
  for (const name of SECTION_CHILD_PREDECESSORS.get(localName) ?? []) {
    const element = childElement(fragment, name)
    if (!element) continue
    const end = fragment.indexOf(element) + element.length
    if (end > position) position = end
  }
  return position
}

function childPattern(localName: string) {
  return new RegExp(
    `<w:${localName}\\b[^>]*?(?:/>|>[\\s\\S]*?</w:${localName}>)`,
    'u',
  )
}

function elementWithAttributes(
  localName: string,
  attrs: Record<string, string>,
) {
  const body = Object.entries(attrs)
    .map(([name, value]) => ` w:${name}="${escapeXmlAttribute(value)}"`)
    .join('')
  return `<w:${localName}${body}/>`
}

function numberAttribute(value: string | undefined) {
  if (value === undefined) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
