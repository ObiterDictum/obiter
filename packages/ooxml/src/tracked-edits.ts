import { isValidXmlText, type DocumentModelWire } from '@obiter/contracts'

import {
  OoxmlError,
  type OoxmlDocument,
  type ParagraphAnchor,
  type TextRunAnchor,
  type XmlElementRange,
} from './model'
import { requireEditablePart } from './model-edit-overlay'
import { insertParagraphAfter } from './model-paragraph-edits'
import {
  expandSelfClosingProperties,
  patchStyleValue,
} from './model-style-edits'
import {
  patchParagraphNumberingXml,
  patchRunEmphasisXml,
  type ParagraphNumbering,
  type RunEmphasis,
} from './model-property-edits'
import {
  applyFragmentReplacements,
  escapeXmlAttribute,
  escapeXmlText,
  renameFragmentElements,
  setOverlayReplacement,
} from './parts/overlay'
import {
  lineBreakRunReplacements,
  preserveTextElementXmlSpace,
} from './text-run-edit'

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
      // Both tracked branches retain the complete run, so unique-identity
      // children such as bookmark and comment range markers are duplicated.
      // Hoisting those children needs a separate identity-preservation design.
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
      insertParagraphAfter(document, story, anchor, text, styleId, offset, {
        prefix,
        wrapRun: (run) =>
          `<${prefix}:ins ${attributes(prefix)}>${run}</${prefix}:ins>`,
      })
    },

    deleteParagraph(anchor: ParagraphAnchor) {
      const part = requireEditablePart(document, anchor.partName)
      const source = part.overlay.source
      if (anchor.runs.length === 0) {
        const story = document.model.stories.find(
          (item) => item.kind === 'document',
        )
        if (!story) throw new OoxmlError('model-node-not-editable')
        const prefix = wordPrefix(source, anchor.paragraphRange, 'p')
        setOverlayReplacement(
          part.overlay,
          `${anchor.wire.id}:tracked-delete`,
          paragraphMarkDeletionReplacement(
            source,
            anchor,
            prefix,
            attributes(prefix),
          ),
        )
        story.paragraphs.splice(story.paragraphs.indexOf(anchor.wire), 1)
        part.dirty = true
        return
      }
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

    setRunEmphasis(anchor: TextRunAnchor, emphasis: RunEmphasis) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.runRange, 'r')
      setTrackedProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.runRange,
        propertiesRange: anchor.runPropertiesRange,
        propertiesName: 'rPr',
        prefix,
        attributes: attributes(prefix),
        patch: (current) => patchRunEmphasisXml(current, emphasis),
      })
    },

    setParagraphNumbering(
      anchor: ParagraphAnchor,
      numbering: ParagraphNumbering,
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      setTrackedProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        propertiesName: 'pPr',
        prefix,
        attributes: attributes(prefix),
        patch: (current) => patchParagraphNumberingXml(current, numbering),
      })
    },
  }
}

function setTrackedProperties(
  document: OoxmlDocument,
  input: {
    id: string
    partName: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    propertiesName: 'rPr' | 'pPr'
    prefix: string
    attributes: string
    patch: (current: string) => string
  },
) {
  const part = requireEditablePart(document, input.partName)
  const previous = input.propertiesRange
    ? part.overlay.source.slice(
        input.propertiesRange.start,
        input.propertiesRange.end,
      )
    : `<${input.prefix}:${input.propertiesName}/>`
  const current = appendPropertyChange(
    input.patch(previous),
    input.prefix,
    input.propertiesName,
    input.attributes,
    previous,
  )
  setOverlayReplacement(part.overlay, `${input.id}:tracked-properties`, {
    start: input.propertiesRange?.start ?? input.nodeRange.startTagEnd,
    end: input.propertiesRange?.end ?? input.nodeRange.startTagEnd,
    value: current,
  })
  part.dirty = true
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
  propertiesName: 'pPr' | 'rPr',
  styleName: 'pStyle' | 'rStyle',
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
    return expandSelfClosingProperties(
      fragment,
      prefix,
      propertiesName,
      instruction,
    )
  }
  return fragment.replace(/(<\/[^>]+>)$/u, `${instruction}$1`)
}

function appendPropertyChange(
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
  return properties.replace(/(<\/[^>]+>)$/u, `${marker}$1`)
}

function styleInstruction(prefix: string, name: string, styleId: string) {
  return `<${prefix}:${name} ${prefix}:val="${escapeXmlAttribute(styleId)}"/>`
}

function replaceRunText(source: string, anchor: TextRunAnchor, text: string) {
  const breakReplacements = lineBreakRunReplacements(
    anchor,
    text,
    source,
    anchor.runRange.start,
  )
  if (breakReplacements) {
    const broken = applyFragmentReplacements(
      source.slice(anchor.runRange.start, anchor.runRange.end),
      breakReplacements,
    )
    if (broken === undefined) throw new OoxmlError('model-node-not-editable')
    return broken
  }
  const replacements = anchor.textRanges.map((range, index) => ({
    start: range.start - anchor.runRange.start,
    end: range.end - anchor.runRange.start,
    value: index === 0 ? escapeXmlText(text) : '',
  }))
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

function renameTextElements(
  fragment: string,
  anchor: TextRunAnchor,
  localName: 'delText',
) {
  const renamed = renameFragmentElements(
    fragment,
    anchor.runRange.start,
    anchor.textElements.map((range) => ({ range })),
    localName,
  )
  if (renamed === undefined) throw new OoxmlError('model-node-not-editable')
  return renamed
}

function paragraphMarkDeletionReplacement(
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
