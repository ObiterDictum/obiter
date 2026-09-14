import {
  isValidXmlText,
  type DocumentEditRun,
  type DocumentModelWire,
} from '@obiter/contracts'

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
  patchParagraphFormatXml,
  patchParagraphNumberingXml,
  patchRunEmphasisXml,
  type ParagraphFormat,
  type ParagraphNumbering,
  type RunEmphasis,
} from './model-property-edits'
import { escapeXmlAttribute, setOverlayReplacement } from './parts/overlay'
import {
  appendPropertyChange,
  extractInsertedRunRpr,
  foldRprIntoInsertedRun,
  foldRprIntoRun,
  mergeTrackedProperties,
  paragraphMarkDeletionReplacement,
  patchStyleChild,
  renameTextElements,
  replaceRunText,
  stripPropertyChange,
  wordPrefix,
} from './tracked-edit-xml'

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
      let newRun = replaceRunText(source, anchor, text)
      const trackedProperties = part.overlay.replacements.get(
        `${anchor.wire.id}:tracked-properties`,
      )
      if (trackedProperties) {
        part.overlay.replacements.delete(`${anchor.wire.id}:tracked-properties`)
        newRun = foldRprIntoRun(newRun, trackedProperties.value, prefix, 'rPr')
      }
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
      runs: readonly DocumentEditRun[],
      styleId: string | null | undefined,
      offset: number,
      paragraphFormat?: ParagraphFormat,
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      insertParagraphAfter(document, story, anchor, runs, styleId, offset, {
        prefix,
        wrapRun: (run) =>
          `<${prefix}:ins ${attributes(prefix)}>${run}</${prefix}:ins>`,
        paragraphFormat,
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
      setTrackedStyleProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.runRange,
        propertiesRange: anchor.runPropertiesRange,
        propertiesName: 'rPr',
        styleName: 'rStyle',
        prefix,
        styleId,
        attributes: attributes(prefix),
        wire: anchor.wire,
      })
    },

    setParagraphStyle(anchor: ParagraphAnchor, styleId: string | null) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      setTrackedStyleProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        propertiesName: 'pPr',
        styleName: 'pStyle',
        prefix,
        styleId,
        attributes: attributes(prefix),
        wire: anchor.wire,
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

    setParagraphFormat(anchor: ParagraphAnchor, format: ParagraphFormat) {
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
        patch: (current) => patchParagraphFormatXml(current, format),
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

  // A tracked text replacement on the same node covers the whole run,
  // including the properties element. When both fire in one batch, fold the
  // property change into the inserted run instead of writing an overlapping
  // full-range replacement.
  const trackedText = part.overlay.replacements.get(`${input.id}:tracked-text`)
  if (trackedText) {
    const currentRpr = extractInsertedRunRpr(
      trackedText.value,
      input.prefix,
      input.propertiesName,
    )
    const patched = appendPropertyChange(
      input.patch(
        stripPropertyChange(currentRpr, input.prefix, input.propertiesName),
      ),
      input.prefix,
      input.propertiesName,
      input.attributes,
      previous,
    )
    part.overlay.replacements.set(`${input.id}:tracked-text`, {
      ...trackedText,
      value: foldRprIntoInsertedRun(
        trackedText.value,
        patched,
        input.prefix,
        input.propertiesName,
      ),
    })
    part.dirty = true
    return
  }

  const key = `${input.id}:tracked-properties`
  const existing = part.overlay.replacements.get(key)
  if (existing) {
    part.overlay.replacements.set(key, {
      ...existing,
      value: mergeTrackedProperties(
        existing.value,
        input.prefix,
        input.propertiesName,
        input.patch,
      ),
    })
    part.dirty = true
    return
  }

  const current = appendPropertyChange(
    input.patch(previous),
    input.prefix,
    input.propertiesName,
    input.attributes,
    previous,
  )
  setOverlayReplacement(part.overlay, key, {
    start: input.propertiesRange?.start ?? input.nodeRange.startTagEnd,
    end: input.propertiesRange?.end ?? input.nodeRange.startTagEnd,
    value: current,
  })
  part.dirty = true
}

function setTrackedStyleProperties(
  document: OoxmlDocument,
  input: {
    id: string
    partName: string
    nodeRange: XmlElementRange
    propertiesRange?: XmlElementRange
    propertiesName: 'rPr' | 'pPr'
    styleName: 'pStyle' | 'rStyle'
    prefix: string
    styleId: string | null
    attributes: string
    wire: { styleId?: string }
  },
) {
  setTrackedProperties(document, {
    id: input.id,
    partName: input.partName,
    nodeRange: input.nodeRange,
    propertiesRange: input.propertiesRange,
    propertiesName: input.propertiesName,
    prefix: input.prefix,
    attributes: input.attributes,
    patch: (current) =>
      patchStyleChild(
        current,
        input.prefix,
        input.propertiesName,
        input.styleName,
        input.styleId,
      ),
  })
  if (input.styleId === null) delete input.wire.styleId
  else input.wire.styleId = input.styleId
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
