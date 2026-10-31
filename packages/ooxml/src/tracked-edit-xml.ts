import {
  OoxmlError,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { expandSelfClosingProperties } from './model-properties'
import {
  applyFragmentReplacements,
  renameFragmentElements,
  escapeXmlAttribute,
  escapeXmlText,
} from './parts/overlay'
import {
  lineBreakRunReplacements,
  preserveTextElementXmlSpace,
  textBreakReplacements,
} from './text-run-edit'

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

export function renameTextElements(
  fragment: string,
  anchor: TextRunAnchor,
  localName: 'delText',
) {
  const origin = anchor.runRange.start
  const renamed = renameFragmentElements(
    fragment,
    origin,
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

function insertedRunFragment(value: string, prefix: string) {
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

export function foldRprIntoTrackedText(
  value: string,
  prefix: string,
  propertiesName: 'rPr' | 'pPr',
  patch: (current: string) => string,
  attributes: () => string,
) {
  const pieces = [
    ...value.matchAll(
      new RegExp(
        `<${prefix}:del\\b[^>]*>[\\s\\S]*?</${prefix}:del>|<${prefix}:ins\\b[^>]*>[\\s\\S]*?</${prefix}:ins>|<${prefix}:r\\b[^>]*>[\\s\\S]*?</${prefix}:r>`,
        'gu',
      ),
    ),
  ]
  if (
    pieces.length === 0 ||
    pieces.map((piece) => piece[0]).join('') !== value
  ) {
    return undefined
  }
  const propertiesPattern = new RegExp(
    `<${prefix}:${propertiesName}\\b[^>]*>[\\s\\S]*?</${prefix}:${propertiesName}>|<${prefix}:${propertiesName}\\b[^>]*/>`,
    'u',
  )
  const patchRunXml = (runXml: string, marker: boolean) => {
    const current =
      runXml.match(propertiesPattern)?.[0] ?? `<${prefix}:${propertiesName}/>`
    const next = current.includes(`<${prefix}:${propertiesName}Change`)
      ? mergeTrackedProperties(current, prefix, propertiesName, patch)
      : marker
        ? appendPropertyChange(
            patch(current),
            prefix,
            propertiesName,
            attributes(),
            current,
          )
        : patch(current)
    return foldRprIntoRun(runXml, next, prefix, propertiesName)
  }
  const survivors = pieces.filter(
    (piece) => !piece[0].startsWith(`<${prefix}:del`),
  )
  if (survivors.length === 0) {
    const run = insertedRunFragment(value, prefix)
    if (!run) return undefined
    return `${value.slice(0, run.runStart)}${patchRunXml(run.runXml, false)}${value.slice(run.runEnd)}`
  }
  return pieces
    .map((piece) => {
      const xml = piece[0]
      if (xml.startsWith(`<${prefix}:del`)) return xml
      if (xml.startsWith(`<${prefix}:ins`)) {
        const run = insertedRunFragment(xml, prefix)
        if (!run) return xml
        return `${xml.slice(0, run.runStart)}${patchRunXml(run.runXml, false)}${xml.slice(run.runEnd)}`
      }
      return patchRunXml(xml, true)
    })
    .join('')
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
  const end = properties.lastIndexOf('>')
  if (end === -1 || end !== properties.length - 1) return properties
  const start = properties.indexOf(
    '</',
    properties.lastIndexOf('>', end - 1) + 1,
  )
  if (start === -1 || start + 2 >= end) return properties
  return properties.slice(0, start) + marker + properties.slice(start)
}

function styleInstruction(prefix: string, name: string, styleId: string) {
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

function insertParagraphMarkDeletion(
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
