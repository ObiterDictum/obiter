import {
  isValidXmlText,
  type DocumentModelWire,
  type DocumentParagraphWire,
  type DocumentTextRunWire,
} from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import {
  escapeXmlAttribute,
  escapeXmlText,
  setOverlayReplacement,
} from './parts/overlay'

export type TrackedEditContext = {
  author: string
  date: string
}

export function createTrackedEditWriter(
  document: OoxmlDocument,
  context: TrackedEditContext,
) {
  if (
    context.author.length === 0 ||
    !isValidXmlText(context.author) ||
    !isValidXmlText(context.date) ||
    !isCanonicalIsoTimestamp(context.date)
  ) {
    throw new OoxmlError('invalid-document-edit')
  }
  let nextChangeId = allocateFirstChangeId(document)
  const attributes = (prefix: string) => {
    const id = String(nextChangeId)
    nextChangeId += 1
    return `${prefix}:id="${id}" ${prefix}:author="${escapeXmlAttribute(context.author)}" ${prefix}:date="${escapeXmlAttribute(context.date)}"`
  }

  return {
    replaceRunText(anchor: TextRunAnchor, text: string) {
      const part = requireEditablePart(document, anchor.partName)
      const source = part.overlay.source
      const prefix = wordPrefix(source, anchor.runRange, 'r')
      const oldRun = renameTextElements(
        source.slice(anchor.runRange.start, anchor.runRange.end),
        anchor,
        'delText',
      )
      const newRun = replaceRunText(source, anchor, text)
      setOverlayReplacement(part.overlay, `${anchor.wire.id}:tracked-text`, {
        start: anchor.runRange.start,
        end: anchor.runRange.end,
        value: `<${prefix}:del ${attributes(prefix)}>${oldRun}</${prefix}:del><${prefix}:ins ${attributes(prefix)}>${newRun}</${prefix}:ins>`,
      })
      anchor.wire.text = text
      part.dirty = true
    },

    insertParagraphAfter(
      story: DocumentModelWire['stories'][number],
      anchor: ParagraphAnchor,
      text: string,
      styleId: string | null | undefined,
      offset: number,
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      const paragraphId = allocateModelId(document, 'para-edit')
      const runId = allocateModelId(document, 'text-edit')
      const run: DocumentTextRunWire = {
        id: runId,
        text,
        preservedXmlFragments: [],
      }
      const paragraph: DocumentParagraphWire = {
        id: paragraphId,
        ...(styleId ? { styleId } : {}),
        runs: [run],
        preservedXmlFragments: [],
      }
      const index = story.paragraphs.indexOf(anchor.wire)
      story.paragraphs.splice(index + 1 + offset, 0, paragraph)
      const properties = styleId
        ? `<${prefix}:pPr><${prefix}:pStyle ${prefix}:val="${escapeXmlAttribute(styleId)}"/></${prefix}:pPr>`
        : ''
      const xmlSpace = /^\s|\s$/u.test(text) ? ' xml:space="preserve"' : ''
      setOverlayReplacement(part.overlay, `${paragraphId}:insert`, {
        start: anchor.paragraphRange.end,
        end: anchor.paragraphRange.end,
        value: `<${prefix}:p>${properties}<${prefix}:ins ${attributes(prefix)}><${prefix}:r><${prefix}:t${xmlSpace}>${escapeXmlText(text)}</${prefix}:t></${prefix}:r></${prefix}:ins></${prefix}:p>`,
      })
      part.dirty = true
    },

    deleteParagraph(anchor: ParagraphAnchor) {
      if (anchor.runs.length === 0) {
        throw new OoxmlError('model-node-not-editable')
      }
      const part = requireEditablePart(document, anchor.partName)
      const source = part.overlay.source
      for (const run of anchor.runs) {
        const prefix = wordPrefix(source, run.runRange, 'r')
        const deletedRun = renameTextElements(
          source.slice(run.runRange.start, run.runRange.end),
          run,
          'delText',
        )
        setOverlayReplacement(part.overlay, `${run.wire.id}:tracked-delete`, {
          start: run.runRange.start,
          end: run.runRange.end,
          value: `<${prefix}:del ${attributes(prefix)}>${deletedRun}</${prefix}:del>`,
        })
      }
      part.dirty = true
    },

    setRunStyle(anchor: TextRunAnchor, styleId: string | null) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.runRange, 'r')
      setTrackedStyle(document, {
        anchor,
        nodeRange: anchor.runRange,
        propertiesRange: anchor.runPropertiesRange,
        styleRange: anchor.runStyleRange,
        propertiesName: 'rPr',
        styleName: 'rStyle',
        prefix,
        styleId,
        attributes: attributes(prefix),
      })
    },

    setParagraphStyle(anchor: ParagraphAnchor, styleId: string | null) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      setTrackedStyle(document, {
        anchor,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        styleRange: anchor.paragraphStyleRange,
        propertiesName: 'pPr',
        styleName: 'pStyle',
        prefix,
        styleId,
        attributes: attributes(prefix),
      })
    },
  }
}

function setTrackedStyle(
  document: OoxmlDocument,
  input: {
    anchor: Pick<TextRunAnchor | ParagraphAnchor, 'partName' | 'wire'>
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    styleRange?: XmlElementRange
    propertiesName: 'rPr' | 'pPr'
    styleName: 'rStyle' | 'pStyle'
    prefix: string
    styleId: string | null
    attributes: string
  },
) {
  const part = requireEditablePart(document, input.anchor.partName)
  const previous = input.propertiesRange
    ? part.overlay.source.slice(
        input.propertiesRange.start,
        input.propertiesRange.end,
      )
    : `<${input.prefix}:${input.propertiesName}/>`
  let current = input.propertiesRange
    ? patchPropertiesStyle(
        part.overlay.source,
        input.propertiesRange,
        input.styleRange,
        input.prefix,
        input.propertiesName,
        input.styleName,
        input.styleId,
      )
    : `<${input.prefix}:${input.propertiesName}>${input.styleId === null ? '' : styleInstruction(input.prefix, input.styleName, input.styleId)}</${input.prefix}:${input.propertiesName}>`
  current = appendPropertyChange(
    current,
    input.prefix,
    input.propertiesName,
    input.attributes,
    previous,
  )
  setOverlayReplacement(part.overlay, `${input.anchor.wire.id}:tracked-style`, {
    start: input.propertiesRange?.start ?? input.nodeRange.startTagEnd,
    end: input.propertiesRange?.end ?? input.nodeRange.startTagEnd,
    value: current,
  })
  if (input.styleId === null) delete input.anchor.wire.styleId
  else input.anchor.wire.styleId = input.styleId
  part.dirty = true
}

function patchPropertiesStyle(
  source: string,
  propertiesRange: XmlElementRange,
  styleRange: XmlElementRange | undefined,
  prefix: string,
  propertiesName: string,
  styleName: string,
  styleId: string | null,
) {
  const fragment = source.slice(propertiesRange.start, propertiesRange.end)
  if (styleRange) {
    const start = styleRange.start - propertiesRange.start
    const end = styleRange.end - propertiesRange.start
    const replacement =
      styleId === null
        ? ''
        : patchStyleValue(fragment.slice(start, end), prefix, styleId)
    return fragment.slice(0, start) + replacement + fragment.slice(end)
  }
  if (styleId === null) return fragment
  const instruction = styleInstruction(prefix, styleName, styleId)
  if (/\/\s*>$/u.test(fragment)) {
    return `${fragment.replace(/\/\s*>$/u, '>')}${instruction}</${prefix}:${propertiesName}>`
  }
  return fragment.replace(/(<\/[^>]+>)$/u, `${instruction}$1`)
}

function appendPropertyChange(
  properties: string,
  prefix: string,
  propertiesName: string,
  attributes: string,
  previous: string,
) {
  const marker = `<${prefix}:${propertiesName}Change ${attributes}>${previous}</${prefix}:${propertiesName}Change>`
  if (/\/\s*>$/u.test(properties)) {
    return `${properties.replace(/\/\s*>$/u, '>')}${marker}</${prefix}:${propertiesName}>`
  }
  return properties.replace(/(<\/[^>]+>)$/u, `${marker}$1`)
}

function styleInstruction(prefix: string, name: string, styleId: string) {
  return `<${prefix}:${name} ${prefix}:val="${escapeXmlAttribute(styleId)}"/>`
}

function patchStyleValue(fragment: string, prefix: string, styleId: string) {
  const escaped = escapeXmlAttribute(styleId)
  const value = /(\s+(?:[^\s:>]+:)?val\s*=\s*)(["'])([^"']*)\2/u
  if (value.test(fragment)) return fragment.replace(value, `$1$2${escaped}$2`)
  return fragment.replace(/(\/\s*>|>)$/u, ` ${prefix}:val="${escaped}"$1`)
}

function replaceRunText(source: string, anchor: TextRunAnchor, text: string) {
  const replacements = anchor.textRanges.map((range, index) => ({
    start: range.start - anchor.runRange.start,
    end: range.end - anchor.runRange.start,
    value: index === 0 ? escapeXmlText(text) : '',
  }))
  const first = anchor.textElements[0]
  if (first && /^\s|\s$/u.test(text)) {
    const opening = source.slice(first.start, first.startTagEnd)
    if (!/\s+xml:space\s*=\s*(["'])preserve\1/u.test(opening)) {
      const xmlSpace = /\s+xml:space\s*=\s*(["'])[^"']*\1/u
      replacements.push({
        start: first.start - anchor.runRange.start,
        end: first.startTagEnd - anchor.runRange.start,
        value: xmlSpace.test(opening)
          ? opening.replace(xmlSpace, ' xml:space="preserve"')
          : opening.replace(/>$/u, ' xml:space="preserve">'),
      })
    }
  }
  return applyFragmentReplacements(
    source.slice(anchor.runRange.start, anchor.runRange.end),
    replacements,
  )
}

function renameTextElements(
  fragment: string,
  anchor: TextRunAnchor,
  localName: 'delText',
) {
  const replacements = anchor.textElements.flatMap((range) => {
    const openingStart = range.start - anchor.runRange.start
    const openingEnd = range.startTagEnd - anchor.runRange.start
    const opening = fragment.slice(openingStart, openingEnd)
    const qualified = opening.match(/^<([^\s/>]+)/u)?.[1]
    if (!qualified) throw new OoxmlError('model-node-not-editable')
    const prefix = qualified.includes(':')
      ? `${qualified.slice(0, qualified.indexOf(':'))}:`
      : ''
    return [
      {
        start: openingStart,
        end: openingEnd,
        value: opening.replace(qualified, `${prefix}${localName}`),
      },
      ...(range.endTagStart < range.end
        ? [
            {
              start: range.endTagStart - anchor.runRange.start,
              end: range.end - anchor.runRange.start,
              value: `</${prefix}${localName}>`,
            },
          ]
        : []),
    ]
  })
  return applyFragmentReplacements(fragment, replacements)
}

function applyFragmentReplacements(
  fragment: string,
  replacements: { start: number; end: number; value: string }[],
) {
  const ordered = [...replacements].sort(
    (left, right) => left.start - right.start,
  )
  let result = ''
  let cursor = 0
  for (const replacement of ordered) {
    if (replacement.start < cursor)
      throw new OoxmlError('model-node-not-editable')
    result += fragment.slice(cursor, replacement.start)
    result += replacement.value
    cursor = replacement.end
  }
  return result + fragment.slice(cursor)
}

function wordPrefix(
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

function isCanonicalIsoTimestamp(value: string) {
  const timestamp = Date.parse(value)
  return !Number.isNaN(timestamp) && new Date(timestamp).toISOString() === value
}

function allocateFirstChangeId(document: OoxmlDocument) {
  const used = new Set(
    [...document.trackedChanges.values()]
      .map(({ wire }) => wire.ooxmlId)
      .filter((id): id is string => id !== undefined && /^[+-]?\d+$/u.test(id))
      .map((id) => BigInt(id).toString()),
  )
  let candidate = 0
  while (used.has(String(candidate))) candidate += 1
  return candidate
}

function allocateModelId(document: OoxmlDocument, prefix: string) {
  const used = new Set(
    document.model.stories.flatMap((story) =>
      story.paragraphs.flatMap((paragraph) => [
        paragraph.id,
        ...paragraph.runs.map(({ id }) => id),
      ]),
    ),
  )
  let sequence = 1
  while (used.has(`${prefix}-${String(sequence).padStart(6, '0')}`))
    sequence += 1
  return `${prefix}-${String(sequence).padStart(6, '0')}`
}
