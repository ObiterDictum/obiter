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
  patchRunEmphasisXml,
  type ParagraphFormat,
  type RunEmphasis,
} from './model-property-edits'
import {
  patchParagraphNumberingXml,
  resolveParagraphNumbering,
  type ParagraphNumbering,
} from './numbering-edits'
import { escapeXmlAttribute, setOverlayReplacement } from './parts/overlay'
import {
  recordDeletedParagraph,
  type LineageRecorder,
} from './document-lineage'
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

/**
 * A tracked-change element the writer just created, addressed by the persisted
 * OOXML change id (`w:id`). It is the only cross-version identity for content
 * that serialization wraps in `w:ins`/`w:del` and the parser therefore excludes
 * from the paragraph model.
 */
export type TrackedChangeCreated = {
  elementName: 'ins' | 'del' | 'rPrChange' | 'pPrChange'
  ooxmlId: string
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
  let created: TrackedChangeCreated[] = []
  const attributes = (
    prefix: string,
    elementName: TrackedChangeCreated['elementName'],
  ) => {
    const id = String(nextChangeId)
    nextChangeId += 1
    created.push({ elementName, ooxmlId: id })
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
        value: `<${prefix}:del ${attributes(prefix, 'del')}>${oldRun}</${prefix}:del><${prefix}:ins ${attributes(prefix, 'ins')}>${newRun}</${prefix}:ins>`,
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
      lineage?: {
        recorder: LineageRecorder
        operationIndex: number
        intentId?: string
      },
      position?: 'after' | 'before',
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      insertParagraphAfter(
        document,
        story,
        anchor,
        runs,
        styleId,
        offset,
        {
          prefix,
          wrapRun: (run) =>
            `<${prefix}:ins ${attributes(prefix, 'ins')}>${run}</${prefix}:ins>`,
          paragraphFormat,
          ...(position ? { position } : {}),
        },
        lineage,
      )
    },

    deleteParagraph(
      anchor: ParagraphAnchor,
      lineage?: { recorder: LineageRecorder; operationIndex: number },
    ) {
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
            attributes(prefix, 'del'),
          ),
        )
        story.paragraphs.splice(story.paragraphs.indexOf(anchor.wire), 1)
        part.dirty = true
        if (lineage) {
          recordDeletedParagraph(
            lineage.recorder,
            anchor.wire,
            lineage.operationIndex,
          )
        }
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
          value: `<${prefix}:del ${attributes(prefix, 'del')}>${deletedRun}</${prefix}:del>`,
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
        attributes: attributes(prefix, 'rPrChange'),
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
        attributes: attributes(prefix, 'pPrChange'),
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
        attributes: attributes(prefix, 'rPrChange'),
        patch: (current) => patchRunEmphasisXml(current, emphasis),
      })
    },

    setParagraphNumbering(
      anchor: ParagraphAnchor,
      numbering: ParagraphNumbering,
    ) {
      const part = requireEditablePart(document, anchor.partName)
      const prefix = wordPrefix(part.overlay.source, anchor.paragraphRange, 'p')
      // A start override points at a newly created or reused numbering
      // instance; resolve it before the tracked pPrChange is built so the
      // recorded change and the current state name the same instance.
      const resolved = resolveParagraphNumbering(document, numbering)
      setTrackedProperties(document, {
        id: anchor.wire.id,
        partName: anchor.partName,
        nodeRange: anchor.paragraphRange,
        propertiesRange: anchor.paragraphPropertiesRange,
        propertiesName: 'pPr',
        prefix,
        attributes: attributes(prefix, 'pPrChange'),
        patch: (current) => patchParagraphNumberingXml(current, resolved),
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
        attributes: attributes(prefix, 'pPrChange'),
        patch: (current) => patchParagraphFormatXml(current, format),
      })
    },

    /**
     * The changes created since the previous call, in order. The lineage uses
     * them to name a reversal by persisted `w:id`, not by run position.
     */
    takeChanges() {
      const next = created
      created = []
      return next
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

/**
 * The next tracked-change id is one past the highest id already in the
 * document, never the lowest free one. A decided change's id is therefore not
 * reused by a later edit, so a stale rejection group can never name a different
 * change it happens to share an id with.
 */
function allocateFirstChangeId(document: OoxmlDocument) {
  let next = 0
  for (const { wire } of document.trackedChanges.values()) {
    const id = wire.ooxmlId
    if (id === undefined || !/^\d+$/u.test(id)) continue
    const value = Number(id)
    if (!Number.isSafeInteger(value)) continue
    if (value >= next) next = value + 1
  }
  return next
}
