import {
  burnNodes,
  paragraphBurnText,
  readBurnPart,
} from './redaction-docx-text'
export { paragraphBurnText }
import { RedactionDocxBurnError } from './redaction-docx-error'
import {
  attributeValue,
  escapeXmlText,
  isWord,
  parseXmlElements,
  WORD_NAMESPACE,
  type OoxmlDocument,
  type ParagraphAnchor,
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

/** Only text-bearing nodes are consumed; zero-width structure stays in place. */
export function burnParagraph(
  document: OoxmlDocument,
  paragraph: ParagraphAnchor,
  replacements: readonly BurnRange[],
): Range[] {
  const source = document.sourceParts.get(paragraph.partName)?.overlay?.source
  if (source === undefined)
    throw new RedactionDocxBurnError('Redaction source XML is unavailable.')
  const spans: BurnRange[] = []
  for (const span of [...replacements].sort(
    (a, b) => a.from - b.from || b.to - a.to,
  )) {
    const previous = spans.at(-1)
    // Overlapping occurrences form one union, labelled by the earliest start
    // (longest first on ties). Adjacent occurrences retain their own token.
    if (previous && previous.to > span.from) {
      previous.to = Math.max(previous.to, span.to)
      continue
    }
    spans.push({ ...span })
  }
  const burned = new Map<BurnRange, Range>()
  const consumed = new Map<BurnRange, number>()
  let offset = 0
  for (const run of paragraph.runs) {
    const prefix = source.slice(run.runRange.start, run.runRange.startTagEnd)
    const close = source.slice(run.runRange.endTagStart, run.runRange.end)
    const properties = run.runProperties.join('')
    const textTag = prefix.match(/^<([^\s:>]+):/u)?.[1] ?? 'w'
    const nodes = burnNodes(document, paragraph.partName, run.runRange)
    nodes.forEach(({ range, text }) => {
      const end = offset + text.length
      const hits = spans.filter((span) => span.from < end && span.to > offset)
      if (hits.length) {
        let cursor = 0
        let value = ''
        const textXml = (value: string) =>
          value
            ? `<${textTag}:t xml:space="preserve">${escapeXmlText(value)}</${textTag}:t>`
            : ''
        for (const span of hits) {
          const from = Math.max(0, span.from - offset)
          const to = Math.min(text.length, span.to - offset)
          if (splitsSurrogate(text, from) || splitsSurrogate(text, to))
            throw new RedactionDocxBurnError(
              'Redaction splits a Unicode character.',
            )
          value += textXml(text.slice(cursor, from))
          if (span.from >= offset) {
            // A separate marker run limits black styling to the harmless marker.
            const style = span.black
              ? blackProperties(
                  source,
                  readBurnPart(document, paragraph.partName).elements,
                  run.runRange,
                  textTag,
                )
              : properties
            value += `${close}${prefix}${style}${textXml(span.text)}${close}${prefix}${properties}`
          }
          consumed.set(span, (consumed.get(span) ?? 0) + to - from)
          const previous = burned.get(span)
          burned.set(span, {
            start: previous?.start ?? range.start,
            end: range.end,
          })
          cursor = to
        }
        value += textXml(text.slice(cursor))
        // Uncovered breaks never enter this branch, including either range edge.
        patch(document, paragraph.partName, range, value)
      }
      offset = end
    })
  }
  if (spans.some((span) => consumed.get(span) !== span.to - span.from))
    throw new RedactionDocxBurnError('Accepted text was not completely burned.')
  return [...burned.values()]
}

function blackProperties(
  source: string,
  elements: XmlElement[],
  run: Range,
  prefix: string,
) {
  const own = elements.find(
    (element) => isWord(element, 'rPr') && element.parent?.start === run.start,
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
  const children = elements.filter((element) => element.parent === own)
  let inner = ''
  let pending = [...additions]
  for (const child of children) {
    const rank = order.indexOf(child.localName)
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
) {
  for (const [partName, ranges] of burned) {
    const source = document.sourceParts.get(partName)?.overlay?.source
    if (source === undefined)
      throw new RedactionDocxBurnError('Redaction source XML is unavailable.')
    const elements = parseXmlElements(source)
    const touches = (range: Range) =>
      ranges.some((hit) => hit.start < range.end && hit.end > range.start)
    const fields: Array<{ start: number; instructions: XmlElement[] }> = []
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
    const linkIds = new Set<string>()
    for (const element of elements) {
      if (isWord(element, 'fldChar')) {
        const type = attributeValue(element, WORD_NAMESPACE, 'fldCharType')
        if (type === 'begin')
          fields.push({ start: element.start, instructions: [] })
        if (type === 'end') {
          const field = fields.pop()
          // A field can regenerate private content from its instruction. Empty it
          // whenever any result is redacted, even if the instruction is outside
          // the span. Keep all field markers so Word can still open the file.
          if (field && touches({ start: field.start, end: element.end }))
            clearInstructions(field.instructions)
        }
      }
      if (isWord(element, 'instrText')) {
        for (const field of fields) field.instructions.push(element)
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
          : element.namespaceUri ===
                'http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing' &&
              element.localName === 'docPr' &&
              touches(element)
            ? ['descr', 'title']
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
      if (touches({ start: field.start, end: source.length }))
        clearInstructions(field.instructions)
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
