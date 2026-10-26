import { containsText, decodeTarget } from './redaction-docx-residual'
import { readBurnPart } from './redaction-docx-text'
import { hiddenXmlMarkup, type MappedDocxNode } from './redaction-docx-map'
import { RedactionDocxBurnError } from './redaction-docx-error'
import {
  attributeValue,
  escapeXmlText,
  isWord,
  parseXmlElements,
  WORD_NAMESPACE,
  type OoxmlDocument,
  type XmlElement,
} from '@obiter/ooxml'

type Range = { start: number; end: number }
export type BurnRange = {
  from: number
  to: number
  text: string
  black?: boolean
}
const REL_NS =
  'http://schemas.openxmlformats.org/officeDocument/2006/relationships'

function patch(
  document: OoxmlDocument,
  partName: string,
  range: Range,
  value: string,
) {
  const part = document.sourceParts.get(partName)
  if (!part?.overlay)
    throw new RedactionDocxBurnError('Redaction source XML is unavailable.')
  part.dirty = true
  part.overlay.replacements.set(`${range.start}:${range.end}`, {
    ...range,
    value,
  })
}

/** Every replacement addresses the immutable extraction source map. */
export function burnMappedNodes(
  document: OoxmlDocument,
  nodes: readonly MappedDocxNode[],
  spans: readonly BurnRange[],
) {
  const burned = new Map<string, Range[]>()
  const emitted = new Set<BurnRange>()
  const styles = new Map<XmlElement, string>()
  const propertiesByRun = new Map<XmlElement, string>()
  let firstSpan = 0
  for (const node of nodes) {
    while (
      firstSpan < spans.length &&
      (spans[firstSpan]?.to ?? 0) <= node.start
    )
      firstSpan++
    const hits: BurnRange[] = []
    for (let i = firstSpan; i < spans.length; i++) {
      const span = spans[i]
      if (!span || span.from >= node.end) break
      if (span.to > node.start) hits.push(span)
    }
    if (!hits.length) continue
    const { source, children } = readBurnPart(document, node.partName)
    const prefix = source.slice(node.run.start, node.run.startTagEnd)
    const close = source.slice(node.run.endTagStart, node.run.end)
    const textTag =
      node.range.qualifiedName.split(':').slice(0, -1).join(':') || 'w'
    const properties =
      propertiesByRun.get(node.run) ??
      (children.get(node.run.start) ?? [])
        .filter((child) => isWord(child, 'rPr'))
        .map((child) => source.slice(child.start, child.end))
        .join('')
    propertiesByRun.set(node.run, properties)
    const carrier = isWord(node.range, 'delText') ? 'delText' : 't'
    const textXml = (value: string) =>
      value
        ? `<${textTag}:${carrier} xml:space="preserve">${escapeXmlText(value)}</${textTag}:${carrier}>`
        : ''
    let cursor = 0
    let value = hiddenXmlMarkup(
      source.slice(node.range.startTagEnd, node.range.endTagStart),
    )
    for (const span of hits) {
      const from = Math.max(0, span.from - node.start)
      const to = Math.min(node.text.length, span.to - node.start)
      if (splitsSurrogate(node.text, from) || splitsSurrogate(node.text, to))
        throw new RedactionDocxBurnError(
          'Redaction splits a Unicode character.',
        )
      value += textXml(node.text.slice(cursor, from))
      if (!emitted.has(span)) {
        let style = properties
        if (span.black) {
          style =
            styles.get(node.run) ??
            blackProperties(document, node.partName, node.run, textTag)
          styles.set(node.run, style)
        }
        value += `${close}${prefix}${style}${textXml(span.text)}${close}${prefix}${properties}`
        emitted.add(span)
      }
      cursor = to
    }
    value += textXml(node.text.slice(cursor))
    patch(document, node.partName, node.range, value)
    const ranges = burned.get(node.partName) ?? []
    ranges.push(node.range)
    burned.set(node.partName, ranges)
  }
  if (spans.some((span) => !emitted.has(span)))
    throw new RedactionDocxBurnError(
      'Accepted text has no burnable characters.',
    )
  return burned
}

/** The renderer's read-only model does not expose these OOXML carriers. Its
 * private input gets equivalent Unicode text; editable output keeps the wire. */
export function normaliseRenderCharacters(
  document: OoxmlDocument,
  nodes: readonly MappedDocxNode[],
) {
  for (const node of nodes) {
    if (
      !['tab', 'cr', 'noBreakHyphen', 'softHyphen', 'sym'].some((name) =>
        isWord(node.range, name),
      )
    )
      continue
    const overlay = document.sourceParts.get(node.partName)?.overlay
    if (
      !overlay ||
      overlay.replacements.has(`${node.range.start}:${node.range.end}`)
    )
      continue
    const prefix = node.run.qualifiedName.slice(
      0,
      node.run.qualifiedName.lastIndexOf(':') + 1,
    )
    patch(
      document,
      node.partName,
      node.range,
      `<${prefix}t xml:space="preserve">${escapeXmlText(node.text)}</${prefix}t>`,
    )
  }
}

function blackProperties(
  document: OoxmlDocument,
  partName: string,
  run: Range,
  prefix: string,
) {
  const { source, children: index } = readBurnPart(document, partName)
  const own = (index.get(run.start) ?? []).find((element) =>
    isWord(element, 'rPr'),
  )
  const additions = [
    { name: 'color', xml: `<${prefix}:color ${prefix}:val="000000"/>` },
    { name: 'highlight', xml: `<${prefix}:highlight ${prefix}:val="black"/>` },
  ]
  if (!own || own.selfClosing)
    return `<${prefix}:rPr>${additions.map((item) => item.xml).join('')}</${prefix}:rPr>`
  // CT_RPr sequence. History remains last and is never treated as active style.
  const order =
    'rStyle rFonts b bCs i iCs caps smallCaps strike dstrike outline shadow emboss imprint noProof snapToGrid vanish webHidden color spacing w kern position sz szCs highlight u effect bdr shd fitText vertAlign rtl cs em lang eastAsianLayout specVanish oMath rPrChange'.split(
      ' ',
    )
  const children = index.get(own.start) ?? []
  let inner = ''
  let pending = [...additions]
  for (const child of children) {
    const rank =
      child.namespaceUri === WORD_NAMESPACE
        ? order.indexOf(child.localName)
        : order.length
    const before = pending.filter((item) => order.indexOf(item.name) <= rank)
    inner += before.map((item) => item.xml).join('')
    pending = pending.filter((item) => !before.includes(item))
    if (!isWord(child, 'color') && !isWord(child, 'highlight'))
      inner += source.slice(child.start, child.end)
  }
  return (
    source.slice(own.start, own.startTagEnd) +
    inner +
    pending.map((item) => item.xml).join('') +
    source.slice(own.endTagStart, own.end)
  )
}

function splitsSurrogate(text: string, offset: number) {
  return (
    offset > 0 &&
    offset < text.length &&
    /[\uD800-\uDBFF]/u.test(text[offset - 1] ?? '') &&
    /[\uDC00-\uDFFF]/u.test(text[offset] ?? '')
  )
}

function removeAttribute(source: string, element: XmlElement, name: string) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return source
    .slice(element.start, element.startTagEnd)
    .replace(new RegExp(`\\s+${escaped}\\s*=\\s*(?:"[^"]*"|'[^']*')`, 'u'), '')
}

export function scrubBurnedFields(
  document: OoxmlDocument,
  burned: ReadonlyMap<string, Range[]>,
  accepted: readonly string[] = [],
) {
  for (const [partName, ranges] of burned) {
    const source = document.sourceParts.get(partName)?.overlay?.source
    if (source === undefined)
      throw new RedactionDocxBurnError('Redaction source XML is unavailable.')
    const { elements } = readBurnPart(document, partName)
    const touches = (range: Range) => {
      let low = 0
      let high = ranges.length
      while (low < high) {
        const middle = (low + high) >>> 1
        if ((ranges[middle]?.end ?? 0) <= range.start) low = middle + 1
        else high = middle
      }
      return (ranges[low]?.start ?? Infinity) < range.end
    }
    const fields: Array<{
      start: number
      instructions: XmlElement[]
      redacted: boolean
      result: boolean
    }> = []
    const clearInstructions = (instructions: XmlElement[]) => {
      for (const instruction of instructions) {
        if (!instruction.selfClosing)
          patch(
            document,
            partName,
            { start: instruction.startTagEnd, end: instruction.endTagStart },
            '',
          )
      }
    }
    const clearField = (field: (typeof fields)[number]) => {
      const instruction = field.instructions
        .map((node) =>
          decodeTarget(source.slice(node.startTagEnd, node.endTagStart)),
        )
        .join('')
      // TOC is a container of independently refreshable entry fields. Its
      // command is harmless unless the command itself contains accepted text.
      if (
        field.redacted &&
        (!/^\s*TOC(?:\s|$)/iu.test(instruction) ||
          accepted.some((text) => containsText(instruction, text)))
      )
        clearInstructions(field.instructions)
    }
    const linkIds = new Set<string>()
    for (const element of elements) {
      if (isWord(element, 'fldChar')) {
        const type = attributeValue(element, WORD_NAMESPACE, 'fldCharType')
        if (type === 'begin')
          fields.push({
            start: element.start,
            instructions: [],
            redacted: false,
            result: false,
          })
        if (type === 'separate') {
          const field = fields.at(-1)
          if (field) field.result = true
        }
        if (type === 'end') {
          const field = fields.pop()
          if (field) clearField(field)
        }
      }
      if (
        touches(element) &&
        (isWord(element, 't') ||
          isWord(element, 'delText') ||
          isWord(element, 'tab') ||
          isWord(element, 'br'))
      ) {
        for (const field of fields) {
          if (field.result) field.redacted = true
        }
      }
      if (isWord(element, 'instrText')) {
        fields.at(-1)?.instructions.push(element)
        if (touches(element)) clearInstructions([element])
      }
      if (isWord(element, 'fldSimple') && touches(element)) {
        const attr = element.attributes.find(
          (a) => a.namespaceUri === WORD_NAMESPACE && a.localName === 'instr',
        )
        if (attr)
          patch(
            document,
            partName,
            { start: element.start, end: element.startTagEnd },
            removeAttribute(source, element, attr.qualifiedName).replace(
              /(\/?>)$/u,
              ` ${attr.qualifiedName}=""$1`,
            ),
          )
      }
      if (isWord(element, 'hyperlink') && touches(element)) {
        const id = attributeValue(element, REL_NS, 'id')
        if (id) linkIds.add(id)
      }
      const names =
        isWord(element, 'hyperlink') && touches(element)
          ? ['tooltip', 'docLocation']
          : []
      if (names.length) {
        let opening = source.slice(element.start, element.startTagEnd)
        for (const attr of element.attributes.filter((attr) =>
          names.includes(attr.localName),
        ))
          opening = removeAttribute(
            opening,
            { ...element, start: 0, startTagEnd: opening.length },
            attr.qualifiedName,
          )
        patch(
          document,
          partName,
          { start: element.start, end: element.startTagEnd },
          opening,
        )
      }
    }
    for (const field of fields) {
      clearField(field)
    }
    // Remove both the target and references to it, including shared references:
    // a hidden external target behind a redacted name is still a disclosure.
    for (const element of elements) {
      const attrs = element.attributes.filter(
        (attr) => attr.namespaceUri === REL_NS && linkIds.has(attr.value),
      )
      if (!attrs.length) continue
      const range = { start: element.start, end: element.startTagEnd }
      const overlay = document.sourceParts.get(partName)?.overlay
      let opening =
        overlay?.replacements.get(`${range.start}:${range.end}`)?.value ??
        source.slice(range.start, range.end)
      for (const attr of attrs)
        opening = removeAttribute(
          opening,
          { ...element, start: 0, startTagEnd: opening.length },
          attr.qualifiedName,
        )
      patch(document, partName, range, opening)
    }
    const slash = partName.lastIndexOf('/')
    const relsName = `${partName.slice(0, slash + 1)}_rels/${partName.slice(slash + 1)}.rels`
    const rels = document.sourceParts.get(relsName)?.overlay?.source
    if (linkIds.size && rels === undefined)
      throw new RedactionDocxBurnError(
        'Redaction relationship XML is unavailable.',
      )
    if (rels !== undefined && linkIds.size) {
      for (const element of parseXmlElements(rels)) {
        if (
          element.localName === 'Relationship' &&
          linkIds.has(attributeValue(element, '', 'Id') ?? '')
        )
          patch(document, relsName, element, '')
      }
    }
  }
}

/** Metadata has no review offsets. Scrub only accepted entity text, including
 * filename spellings, preserving descriptions and authors unrelated to it. */
export function scrubAcceptedMetadata(
  document: OoxmlDocument,
  accepted: readonly string[],
) {
  for (const [partName, part] of document.sourceParts) {
    if (!part.overlay) continue
    const { source, elements } = readBurnPart(document, partName)
    for (const element of elements) {
      const names =
        element.namespaceUri ===
          'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' &&
        element.localName === 'docPr'
          ? ['descr', 'title', 'name']
          : element.namespaceUri ===
                'http://schemas.openxmlformats.org/drawingml/2006/picture' &&
              element.localName === 'cNvPr'
            ? ['descr', 'name']
            : element.namespaceUri === WORD_NAMESPACE &&
                element.attributes.some((attr) => attr.localName === 'author')
              ? ['author', 'initials']
              : []
      if (!names.length) continue
      let opening = source.slice(element.start, element.startTagEnd)
      let authorBurned = false
      // Initials follow a burned author whichever attribute comes first.
      const attributes = element.attributes
        .filter((attr) => names.includes(attr.localName))
        .sort(
          (a, b) =>
            Number(a.localName === 'initials') -
            Number(b.localName === 'initials'),
        )
      for (const attr of attributes) {
        let value =
          authorBurned && attr.localName === 'initials'
            ? '[REDACTED]'
            : decodeTarget(attr.value)
        for (const name of accepted) {
          for (const spelling of [
            name,
            name.replaceAll(/\s+/gu, '_'),
            name.replaceAll(/\s+/gu, '-'),
          ]) {
            if (
              !spelling ||
              !containsText(value.toLowerCase(), spelling.toLowerCase())
            )
              continue
            const escaped = spelling.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
            value = value.replace(
              new RegExp(
                `(?<![\\p{L}\\p{N}])${escaped}(?![\\p{L}\\p{N}])`,
                'giu',
              ),
              '[REDACTED]',
            )
          }
        }
        if (value !== decodeTarget(attr.value)) {
          if (attr.localName === 'author') authorBurned = true
          opening = removeAttribute(
            opening,
            { ...element, start: 0, startTagEnd: opening.length },
            attr.qualifiedName,
          ).replace(
            /(\/?>)$/u,
            ` ${attr.qualifiedName}="${escapeXmlText(value).replaceAll('"', '&quot;')}"$1`,
          )
        }
      }
      if (opening !== source.slice(element.start, element.startTagEnd))
        patch(
          document,
          partName,
          { start: element.start, end: element.startTagEnd },
          opening,
        )
    }
  }
}
